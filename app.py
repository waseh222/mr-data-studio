"""InsightForge Studio: offline-first local analytics web desktop UI.
Start with ``python app.py``. Data is stored on this PC, never uploaded to a cloud.
"""
from __future__ import annotations

import io
import json
import os
import re
import sys
import tempfile
import time
import uuid
import zipfile
import sqlite3
import socket
import ipaddress
import webbrowser
import threading
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, UploadFile, File, Query, Request
from fastapi.responses import FileResponse, HTMLResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from studio_plus import guided_analysis, ModelManager, DocumentLibrary, ollama_models, ollama_chat
from analytics_core import (native, records, basic_profile, auto_eda, apply_clean, calculate_column,
                            chart, stat_analysis, run_sql, ml_train, clean_headers, pandas_transform)

if getattr(sys,'frozen',False):
    RESOURCE_BASE=Path(sys._MEIPASS)
else:
    RESOURCE_BASE=Path(__file__).resolve().parent
STATIC=RESOURCE_BASE/'static'
# Default to D: on Windows (data and models stay off the cramped system disk).
DEFAULT_HOME=(Path('D:/InsightForge Analytics Studio/workspace') if os.name=='nt' and Path('D:/').exists()
              else Path.home()/'InsightForge Studio')
WORKSPACE=Path(os.environ.get('INSIGHTFORGE_HOME',str(DEFAULT_HOME)))
WORKSPACE.mkdir(parents=True, exist_ok=True)
DATA=WORKSPACE/'datasets'; DATA.mkdir(exist_ok=True)
MANIFEST=WORKSPACE/'workspace.json'
MAX_UPLOAD=65*1024*1024
MAX_ROWS=200_000
MAX_COLS=400
MAX_TABLE_ROWS=200

class DatasetStore:
    def __init__(self):
        self.frames:dict[str,pd.DataFrame]={}
        self.undo:dict[str,list[pd.DataFrame]]={}
        self.redo:dict[str,list[pd.DataFrame]]={}
        self.info:dict[str,dict[str,Any]]={}
        self.active:str|None=None
        self.activities:list[dict[str,str]]=[]
        if MANIFEST.exists():
            try:
                contents=json.loads(MANIFEST.read_text(encoding='utf-8'))
                self.info={k:v for k,v in contents.get('datasets',{}).items() if re.fullmatch(r'[0-9a-f]{32}',k) and (DATA/f'{k}.json').exists()}
                self.active=contents.get('active') if contents.get('active') in self.info else next(iter(self.info),None)
                self.activities=contents.get('activities',[])[:80]
            except (ValueError,OSError):
                pass

    def _manifest(self):
        data={'datasets':self.info,'active':self.active,'activities':self.activities[:80]}
        tmp=MANIFEST.with_suffix('.tmp')
        tmp.write_text(json.dumps(data,ensure_ascii=False,indent=2,default=str),encoding='utf-8')
        os.replace(tmp,MANIFEST)

    def log(self,message):
        self.activities.insert(0,{'when':datetime.now().strftime('%d %b %Y %H:%M'),'message':str(message)})
        self.activities=self.activities[:80]
        self._manifest()

    def save(self,key,df):
        df=clean_headers(df)
        if df.shape[0]>MAX_ROWS or df.shape[1]>MAX_COLS:
            raise ValueError(f'Limit: {MAX_ROWS:,} rows and {MAX_COLS} columns per dataset')
        path=DATA/f'{key}.json'
        tmp=DATA/f'{key}.tmp'
        df.to_json(tmp,orient='table',date_format='iso',index=False)
        os.replace(tmp,path)
        self.frames[key]=df
        self.info[key]['modified']=datetime.now().strftime('%d %b %Y %H:%M')
        self._manifest()

    def add(self,df,name,origin):
        df=clean_headers(df)
        if df.shape[0]>MAX_ROWS or df.shape[1]>MAX_COLS:
            raise ValueError(f'Limit: {MAX_ROWS:,} rows and {MAX_COLS} columns per dataset')
        if len(self.info)>=30: raise ValueError('Workspace limit of 30 datasets reached. Remove an old dataset first.')
        key=uuid.uuid4().hex
        self.info[key]={'name':str(name)[:120], 'origin':str(origin)[:200],
                        'created':datetime.now().strftime('%d %b %Y %H:%M')}
        self.active=key
        self.save(key,df)
        # Store original for Reset to imported data.
        (DATA/f'{key}.original.json').write_bytes((DATA/f'{key}.json').read_bytes())
        self.log(f'Imported {name}: {len(df):,} rows × {len(df.columns)} columns')
        return key

    def get(self,key:str|None=None):
        key=key or self.active
        if not key or key not in self.info: raise ValueError('Import or select a dataset first')
        if key not in self.frames:
            self.frames[key]=pd.read_json(DATA/f'{key}.json',orient='table')
        return self.frames[key]

    def select(self,key):
        if key not in self.info:raise ValueError('Dataset not found')
        self.active=key;self._manifest()

    def delete(self,key):
        if key not in self.info:raise ValueError('Dataset not found')
        for suffix in ('.json','.original.json'):
            (DATA/f'{key}{suffix}').unlink(missing_ok=True)
        del self.info[key]
        self.frames.pop(key,None);self.undo.pop(key,None);self.redo.pop(key,None)
        if self.active==key:self.active=next(iter(self.info),None)
        self.log('Removed a dataset from the local workspace')

    def change(self,key,df,description):
        old=self.get(key)
        self.undo.setdefault(key,[]).append(old.copy(deep=True))
        self.undo[key]=self.undo[key][-10:]
        self.redo[key]=[]
        self.save(key,df)
        self.log(description)

    def step(self,key,mode):
        src,dst=(self.undo,self.redo) if mode=='undo' else (self.redo,self.undo)
        if not src.get(key):raise ValueError(f'Nothing to {mode}')
        old=self.get(key)
        next_df=src[key].pop()
        dst.setdefault(key,[]).append(old.copy(deep=True))
        self.save(key,next_df)
        self.log(f'{mode.title()} on {self.info[key]["name"]}')

    def reset(self,key):
        path=DATA/f'{key}.original.json'
        if not path.exists():raise ValueError('Original dataset snapshot missing')
        original=pd.read_json(path,orient='table')
        self.change(key,original,'Restored original imported dataset')

store=DatasetStore()
models=ModelManager(WORKSPACE)
knowledge=DocumentLibrary(WORKSPACE)

class CleanRequest(BaseModel):
    operation:str
    columns:list[str]=[]
    value:Any=None
    method:str|None=None
    new_name:str|None=None

class EditRequest(BaseModel):
    row:int
    column:str
    value:Any=None

class FormulaRequest(BaseModel):
    name:str
    a:str
    op:str
    b:str|None=None
    constant:float|None=None

class ChartRequest(BaseModel):
    kind:str='histogram'
    x:str|None=None
    y:str|None=None
    color:str|None=None
    agg:str='count'
    bins:int=30
    title:str|None=None

class StatsRequest(BaseModel):
    test:str
    x:str
    y:str|None=None

class MLRequest(BaseModel):
    target:str
    algorithm:str='random_forest'
    task:str='auto'
    test_fraction:float=.2

class SQLRequest(BaseModel):
    query:str
    limit:int=1000

class TransformRequest(BaseModel):
    operation:str
    right_id:str|None=None
    group:list[str]=[]
    measure:str|None=None
    agg:str='sum'
    pivot_column:str|None=None
    right_key:str|None=None
    how:str='inner'
    n:int=500
    window:int=7

class TextImport(BaseModel):
    text:str
    name:str='Pasted Data'
    format:str='csv'

class URLImport(BaseModel):
    url:str
    name:str='Remote Data'

app=FastAPI(title='InsightForge Analytics Studio',version='2.0.0',docs_url='/api/docs',redoc_url=None)
@app.get('/static/vendor/plotly.min.js', include_in_schema=False)
def plotly_javascript():
    bundled = STATIC / 'vendor' / 'plotly.min.js'
    if bundled.is_file():
        return FileResponse(bundled, media_type='application/javascript')

    import plotly
    installed = Path(plotly.__file__).resolve().parent / 'package_data' / 'plotly.min.js'
    if installed.is_file():
        return FileResponse(installed, media_type='application/javascript')
    raise HTTPException(status_code=404, detail='The installed Plotly package has no JavaScript bundle.')


app.mount('/static',StaticFiles(directory=STATIC),name='static')

@app.exception_handler(ValueError)
async def value_error_handler(request, exc:ValueError):
    from fastapi.responses import JSONResponse
    return JSONResponse(status_code=400,content={'detail':str(exc)})

@app.get('/')
def index():return FileResponse(STATIC/'index.html')

@app.get('/api/health')
def health():return {'ok':True,'version':'2.0.0','offline':True,'workspace':str(WORKSPACE)}

@app.get('/api/state')
def state():
    datasets=[{'id':k,**v} for k,v in store.info.items()]
    profile=basic_profile(store.get()) if store.active else None
    return {'datasets':datasets,'active':store.active,'profile':profile,
            'activities':store.activities[:18], 'undo':len(store.undo.get(store.active,[])),
            'redo':len(store.redo.get(store.active,[]))}


def _read_file(data:bytes,name:str):
    ext=Path(name).suffix.lower()
    buf=io.BytesIO(data)
    if ext in ('.csv','.tsv','.txt'):
        try:
            return pd.read_csv(buf,sep='\t' if ext=='.tsv' else None,engine='python')
        except Exception as e:
            buf.seek(0)
            return pd.read_csv(buf,sep='\t' if ext=='.tsv' else ',',encoding='latin-1')
    if ext in ('.xlsx','.xlsm','.xls'):
        # Select first worksheet; other sheets can be exported separately as XLSX or CSV.
        return pd.read_excel(buf, sheet_name=0)
    if ext=='.json':
        obj=json.loads(data.decode('utf-8-sig'))
        if isinstance(obj,list):return pd.json_normalize(obj)
        if isinstance(obj,dict):
            for v in obj.values():
                if isinstance(v,list) and v and isinstance(v[0],dict):return pd.json_normalize(v)
            return pd.json_normalize(obj)
        raise ValueError('JSON must contain an array or object')
    if ext=='.jsonl':return pd.read_json(buf,lines=True)
    if ext=='.parquet':
        try:return pd.read_parquet(buf)
        except ImportError:raise ValueError('Parquet support requires: pip install pyarrow')
    if ext in ('.db','.sqlite','.sqlite3'):
        path=None
        try:
            with tempfile.NamedTemporaryFile(suffix='.sqlite',delete=False) as f:
                path=f.name;f.write(data)
            con=sqlite3.connect(f'file:{path}?mode=ro',uri=True)
            try:
                tables=pd.read_sql_query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",con)
                if tables.empty: raise ValueError('No user tables found in SQLite file')
                table=tables.name.iloc[0]
                escaped='"'+table.replace('"','""')+'"'
                return pd.read_sql_query(f'SELECT * FROM {escaped} LIMIT {MAX_ROWS+1}',con)
            finally:con.close()
        finally:
            if path:os.unlink(path)
    raise ValueError(f'Unsupported file extension: {ext}')


def _import_bytes(data:bytes,name:str):
    if len(data)>MAX_UPLOAD:raise ValueError('File exceeds 65 MB import limit')
    if name.lower().endswith('.zip'):
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            items=[]
            for zi in archive.infolist():
                if zi.is_dir() or zi.file_size>30*1024*1024 or (zi.compress_size and zi.file_size/max(zi.compress_size,1)>150):continue
                if Path(zi.filename).suffix.lower() not in ('.csv','.tsv','.txt','.xlsx','.xlsm','.xls','.json','.jsonl','.parquet','.sqlite','.sqlite3','.db'):continue
                items.append(zi)
            if not items:raise ValueError('No supported datasets found inside ZIP')
            if sum(i.file_size for i in items[:10]) > 100*1024*1024:
                raise ValueError('Total extracted ZIP dataset size exceeds 100 MB')
            imported=[]
            for item in items[:10]:
                blob=archive.read(item)
                df=_read_file(blob,item.filename)
                key=store.add(df,Path(item.filename).stem,'ZIP: '+Path(name).name)
                imported.append({'id':key,'name':store.info[key]['name']})
            return imported
    df=_read_file(data,name)
    key=store.add(df,Path(name).stem,name)
    return [{'id':key,'name':store.info[key]['name']}]

@app.post('/api/import')
async def import_files(files:list[UploadFile]=File(...)):
    all_imported=[]
    for f in files[:15]:
        data=await f.read(MAX_UPLOAD+1)
        all_imported.extend(_import_bytes(data,f.filename or 'data.csv'))
    return {'imported':all_imported}

@app.post('/api/import-text')
def import_text(req:TextImport):
    if len(req.text.encode('utf-8'))>MAX_UPLOAD:raise ValueError('Text too large')
    fmt=req.format.lower()
    if fmt not in ('csv','tsv','json','jsonl'):raise ValueError('Choose CSV, TSV, JSON or JSONL')
    imported=_import_bytes(req.text.encode('utf-8'),f'{req.name}.{fmt}')
    return {'imported':imported}


def _public_url(url:str):
    u=urlparse(url)
    if u.scheme not in ('https','http') or not u.hostname:raise ValueError('Enter an HTTP/HTTPS dataset URL')
    try:
        for record in socket.getaddrinfo(u.hostname,u.port or (443 if u.scheme=='https' else 80),type=socket.SOCK_STREAM):
            ip=ipaddress.ip_address(record[4][0])
            if not ip.is_global:raise ValueError('Private, loopback and local URLs are not allowed')
    except socket.gaierror as e:raise ValueError('Host cannot be resolved') from e
    return u

@app.post('/api/import-url')
def import_url(req:URLImport):
    import requests
    u=_public_url(req.url)
    try:
        resp=requests.get(req.url,timeout=(5,20),stream=True,allow_redirects=False,
                          headers={'User-Agent':'InsightForgeStudio/1.0'})
        if resp.is_redirect:raise ValueError('Redirecting URLs are not allowed; use the direct URL')
        resp.raise_for_status()
        content=bytearray()
        for chunk in resp.iter_content(1024*256):
            content.extend(chunk)
            if len(content)>MAX_UPLOAD:raise ValueError('Remote file exceeds 65 MB')
    except requests.RequestException as e:raise ValueError(f'Could not fetch URL: {e}') from e
    ext=Path(u.path).suffix.lower()
    if ext not in ('.csv','.tsv','.json','.jsonl','.xlsx','.parquet'):
        ext='.json' if 'json' in resp.headers.get('content-type','') else '.csv'
    return {'imported':_import_bytes(bytes(content),req.name+ext)}

@app.post('/api/demo')
def demo():
    rng=np.random.default_rng(26)
    n=700
    regions=rng.choice(['North','South','East','West','Central'],n)
    products=rng.choice(['Enterprise','Professional','Starter','Team'],n)
    units=rng.integers(1,35,n)
    prices=np.select([products=='Enterprise',products=='Professional',products=='Starter'],[270,145,55],default=95)
    revenue=(units*prices*rng.uniform(.85,1.18,n)).round(2)
    df=pd.DataFrame({'Date':pd.date_range('2025-01-01',periods=n,freq='D'),
                     'Region':regions,'Product':products,'Units':units,'Revenue':revenue,
                     'Profit':(revenue*rng.uniform(.18,.39,n)).round(2),
                     'Customer_Score':rng.integers(45,101,n),'Campaign':rng.choice(['Email','Organic','Referral','Paid'],n)})
    df.loc[rng.choice(n,26,replace=False),'Customer_Score']=np.nan
    df=pd.concat([df,df.iloc[:8]],ignore_index=True)
    key=store.add(df,'Retail Performance Demo','Built-in synthetic demonstration data')
    return {'imported':[{'id':key,'name':'Retail Performance Demo'}]}

@app.post('/api/select/{key}')
def select(key:str):store.select(key);return {'active':key}

@app.delete('/api/datasets/{key}')
def delete(key:str):store.delete(key);return {'ok':True}

@app.get('/api/table')
def table(page:int=Query(1,ge=1),page_size:int=Query(25,ge=1,le=MAX_TABLE_ROWS),
          search:str='',sort:str='',descending:bool=False):
    df=store.get()
    view=df.copy()
    view['_if_row_id']=np.arange(len(view))
    if search:
        if len(search)>150:raise ValueError('Search text too long')
        text_cols=df.columns
        mask=np.zeros(len(view),dtype=bool)
        for col in text_cols:
            mask |= view[col].astype(str).str.contains(search,case=False,na=False,regex=False).to_numpy()
        view=view.loc[mask]
    if sort and sort in view.columns and sort!='_if_row_id':
        view=view.sort_values(sort,ascending=not descending,na_position='last',kind='stable')
    count=len(view)
    sl=view.iloc[(page-1)*page_size:page*page_size]
    row_ids=sl.pop('_if_row_id').tolist()
    return {'columns':list(df.columns),'dtypes':[str(t) for t in df.dtypes],
            'rows':[{'_row_id':int(idx),**v} for idx,v in zip(row_ids,records(sl))],
            'total':count,'page':page,'page_size':page_size}

@app.patch('/api/cell')
def cell(req:EditRequest):
    key=store.active;df=store.get()
    if req.row<0 or req.row>=len(df) or req.column not in df:raise ValueError('Cell not found')
    val=req.value
    if val is None or val=='':val=np.nan
    if pd.api.types.is_numeric_dtype(df[req.column]) and pd.notna(val):
        try:val=float(val)
        except (ValueError,TypeError):raise ValueError('Enter a numeric value for this column, or clear it for missing')
    if pd.api.types.is_datetime64_any_dtype(df[req.column]) and pd.notna(val):
        val=pd.to_datetime(val,errors='coerce')
        if pd.isna(val):raise ValueError('Date value could not be parsed')
    changed=df.copy()
    if isinstance(changed[req.column].dtype, pd.CategoricalDtype):changed[req.column]=changed[req.column].astype('object')
    changed.at[req.row,req.column]=val
    store.change(key,changed,f'Edited cell in {req.column}, row {req.row+1}')
    return {'ok':True,'value':native(changed.at[req.row,req.column])}

@app.post('/api/clean')
def cleaning(req:CleanRequest):
    key=store.active
    before=store.get()
    result=apply_clean(before,**req.model_dump())
    store.change(key,result,f'Clean: {req.operation} ({len(before):,} → {len(result):,} rows)')
    return {'ok':True,'before':list(before.shape),'after':list(result.shape),'profile':basic_profile(result)}

@app.post('/api/formula')
def formula(req:FormulaRequest):
    key=store.active;out=calculate_column(store.get(),**req.model_dump())
    store.change(key,out,f'Created calculated field {req.name}')
    return {'ok':True}

@app.post('/api/undo')
@app.post('/api/redo')
@app.post('/api/reset')
def undo_redo_reset(request: Request):
    action=request.url.path.rsplit('/',1)[-1]
    if action in ('undo','redo'):store.step(store.active,action)
    elif action=='reset':store.reset(store.active)
    else:raise HTTPException(404, 'Unknown action')
    return {'ok':True}

@app.post('/api/transform')
def transform(req:TransformRequest):
    if req.right_id and req.right_id not in store.info:raise ValueError('Right-hand dataset not found')
    right=store.get(req.right_id) if req.right_id else None
    source=store.info[store.active]['name']
    frame=pandas_transform(store.get(),req.operation,right=right,group=req.group,
                           measure=req.measure,agg=req.agg,pivot_column=req.pivot_column,
                           right_key=req.right_key,how=req.how,n=req.n,window=req.window)
    new_name=f'{source[:70]} – {req.operation.replace("_"," ").title()}'
    key=store.add(frame,new_name,f'Derived from {source}')
    return {'id':key,'name':new_name,'rows':len(frame),'columns':len(frame.columns)}

@app.get('/api/eda')
def eda():return auto_eda(store.get())

LAST_CHART:dict[str,Any]={}
@app.post('/api/chart')
def create_chart(req:ChartRequest):
    fig=chart(store.get(),**req.model_dump())
    LAST_CHART.clear();LAST_CHART.update(req.model_dump())
    return json.loads(fig.to_json())

@app.get('/api/chart/html')
def chart_html():
    if not LAST_CHART:raise ValueError('Create a chart first')
    fig=chart(store.get(),**LAST_CHART)
    html=fig.to_html(full_html=True,include_plotlyjs=True,config={'responsive':True})
    return Response(html,media_type='text/html',headers={'Content-Disposition':'attachment; filename="InsightForge_Chart.html"'})

@app.get('/api/chart/png')
def chart_png():
    if not LAST_CHART:raise ValueError('Create a chart first')
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    import seaborn as sns
    spec=LAST_CHART; kind=spec['kind'];df=store.get().sample(n=min(6000,len(store.get())),random_state=42)
    x=spec.get('x');y=spec.get('y');hue=spec.get('color')
    sns.set_theme(style='darkgrid',palette='crest')
    fig,ax=plt.subplots(figsize=(12,7),dpi=140)
    try:
        if kind in ('histogram','density'): sns.histplot(data=df,x=x,hue=hue,kde=True,ax=ax,bins=spec.get('bins',30),color='#7c78fa')
        elif kind=='scatter':sns.scatterplot(data=df,x=x,y=y,hue=hue,ax=ax)
        elif kind=='line':sns.lineplot(data=df,x=x,y=y,hue=hue,ax=ax)
        elif kind=='box':sns.boxplot(data=df,x=x,y=y,hue=hue,ax=ax)
        elif kind=='violin':sns.violinplot(data=df,x=x,y=y,hue=hue,ax=ax)
        elif kind in ('bar','count'):
            if kind=='bar' and y:
                sns.barplot(data=df,x=x,y=y,hue=hue,ax=ax,color='#7c78fa',estimator=spec.get('agg','mean') if spec.get('agg') not in ('count',) else 'mean')
            else:
                sns.countplot(data=df,x=x,hue=hue,ax=ax,order=df[x].value_counts().head(15).index,color='#7c78fa')
        elif kind=='heatmap':sns.heatmap(df.select_dtypes(include='number').corr(),annot=True,cmap='coolwarm',ax=ax)
        elif kind=='area':df.plot.area(x=x,y=y,ax=ax)
        else:raise ValueError('PNG export is supported for histogram, density, scatter, line, box, violin, count, bar, heatmap and area charts. Use HTML for other interactive chart types.')
        ax.set_title(spec.get('title') or f'InsightForge • {kind.title()}',fontsize=17,pad=16)
        fig.tight_layout()
        buff=io.BytesIO();fig.savefig(buff,format='png',bbox_inches='tight');buff.seek(0)
        return StreamingResponse(buff,media_type='image/png',headers={'Content-Disposition':'attachment; filename="InsightForge_Chart.png"'})
    finally:plt.close(fig)

@app.post('/api/stats')
def statistics(req:StatsRequest):return stat_analysis(store.get(),**req.model_dump())

@app.post('/api/ml')
def ml(req:MLRequest):
    result=ml_train(store.get(),**req.model_dump())
    store.log(f'Trained {req.algorithm} model for {req.target} (holdout evaluation)')
    return result


# Version 2: no-code guided analysis + models with practical manual prediction.
class GuidedAnalysisRequest(BaseModel):
    kind:str='auto'
    x:str|None=None
    y:str|None=None
    group:str|None=None

class ModelBuildRequest(BaseModel):
    target:str
    task:str='auto'
    algorithm:str='random_forest'
    test_fraction:float=.2
    features:list[str]|None=None

class PredictRequest(BaseModel):
    values:dict[str,Any]

class AskRequest(BaseModel):
    question:str
    model:str|None=None
    mode:str='retrieve'

class ChatRequest(BaseModel):
    prompt:str
    model:str
    use_data:bool=False

@app.post('/api/analyze')
def analyze(req:GuidedAnalysisRequest):
    return guided_analysis(store.get(),**req.model_dump())

@app.post('/api/analyze/report')
def guided_report(req:GuidedAnalysisRequest):
    """Portable standalone HTML: chart assets embedded so it works without the server."""
    import html as html_lib
    import plotly.graph_objects as go
    import plotly.io as pio
    r=guided_analysis(store.get(),**req.model_dump())
    name=html_lib.escape(store.info[store.active]['name'])
    parts=[f'<h1>InsightForge Guided Analytics</h1><p><b>Dataset:</b> {name} &middot; <b>Rows analyzed:</b> {r["rows_analyzed"]:,}</p>']
    parts.append('<h2>Automated findings</h2>')
    for sentence in r['insights']:parts.append(f'<p>{html_lib.escape(sentence)}</p>')
    first=True
    for p in r['panels']:
        parts.append(f'<section><h2>{html_lib.escape(p["title"])}</h2><p>{html_lib.escape(p["description"])}</p>')
        if p['figure']:
            figure=go.Figure(data=p['figure']['data'],layout=p['figure']['layout'])
            parts.append(pio.to_html(figure,full_html=False,include_plotlyjs=True if first else False))
            first=False
        if p['rows']:
            parts.append(pd.DataFrame(p['rows']).to_html(index=False,classes='data',escape=True))
        parts.append('</section>')
    parts.append('<footer>Exploratory analysis only. Correlation does not establish causation.</footer>')
    css='body{font:14px Segoe UI,Arial;background:#f4f7fc;color:#193254;margin:40px auto;max-width:1150px;line-height:1.6}h1{font-size:28px;color:#1a4192}h2{font-size:19px;color:#1f426d}section{background:white;padding:22px;margin:25px 0;border:1px solid #d8e3f1;border-radius:12px}table.data{border-collapse:collapse;width:100%;overflow:auto;display:block}th,td{border:1px solid #dbe5ef;padding:9px;text-align:left}th{background:#e8eff9}footer{margin:40px 0;color:#60748d;font-size:12px}'
    html='<!doctype html><html lang="en"><head><meta charset="utf-8"><title>InsightForge Analytics Report</title><style>'+css+'</style></head><body>'+''.join(parts)+'</body></html>'
    return Response(html,media_type='text/html',headers={'Content-Disposition':'attachment; filename="InsightForge_Guided_Analysis.html"'})

@app.get('/api/models')
def list_models():return {'models':models.list()}

@app.post('/api/models/train')
def train_model(req:ModelBuildRequest):
    result=models.train(store.get(),**req.model_dump())
    models.models[result['id']]['dataset_id']=store.active
    models.registry.write_text(json.dumps(models.models,ensure_ascii=False,indent=2,default=native),encoding='utf-8')
    store.log(f'Trained {result["algorithm"]} {result["task"]} model for {result["target"]}')
    return result

@app.get('/api/models/{key}')
def model_details(key:str):
    if key not in models.models:raise ValueError('Model not found')
    return {'id':key,**models.models[key]}

@app.post('/api/models/{key}/predict')
def predict_one(key:str,req:PredictRequest):
    return models.predict(key,req.values)

@app.delete('/api/models/{key}')
def delete_model(key:str):return models.delete(key)

@app.get('/api/knowledge')
def document_list():return {'documents':knowledge.list()}

@app.post('/api/knowledge/import')
async def knowledge_import(files:list[UploadFile]=File(...)):
    result=[]
    for file in files[:6]:
        data=await file.read(10_000_001)
        result.append(knowledge.add(file.filename or 'document.txt',data))
    return {'imported':result}

@app.delete('/api/knowledge/{key}')
def knowledge_delete(key:str):return knowledge.delete(key)

@app.post('/api/knowledge/ask')
def knowledge_ask(req:AskRequest):
    passages=knowledge.retrieve(req.question)
    if req.mode=='generate':
        if not req.model:raise ValueError('Choose a local Ollama model for generated answers')
        answer=ollama_chat(req.question,req.model,'\n\n'.join(f'[{p["document"]} chunk {p["chunk"]}] {p["text"]}' for p in passages))
        return {'answer':answer,'passages':passages,'mode':'local_generation'}
    answer=('\n\n'.join(f'{p["document"]} · part {p["chunk"]}: {p["text"][:850]}' for p in passages)
            if passages else 'No relevant passage found. Try a different question or document.')
    return {'answer':answer,'passages':passages,'mode':'retrieval_only'}

@app.get('/api/ollama/models')
def local_models():return ollama_models()

@app.post('/api/ollama/chat')
def local_chat(req:ChatRequest):
    context=''
    if req.use_data:
        df=store.get()
        preview=df.head(8).to_csv(index=False)[:7000]
        context=f'Dataset name: {store.info[store.active]["name"]}; {len(df)} rows and {len(df.columns)} columns. The following is ONLY a sample, not the full data.\n'+preview
    return {'answer':ollama_chat(req.prompt,req.model,context),'local_only':True}

@app.post('/api/sql')
def sql(req:SQLRequest):
    names={}
    for key,info in store.info.items():
        suffix=re.sub(r'\W+','_',info['name']).strip('_').lower()[:40] or 'dataset'
        t='dataset_'+suffix
        if t in names:t=t+'_'+key[:5]
        names[t]=store.get(key)
    return run_sql(names,req.query,'dataset_'+re.sub(r'\W+','_',store.info[store.active]['name']).strip('_').lower()[:40],req.limit)

@app.get('/api/export/{format}')
def export(format:str):
    df=store.get();name=re.sub(r'[^a-zA-Z0-9_]+','_',store.info[store.active]['name'])[:50] or 'dataset'
    if format=='csv':content=df.to_csv(index=False).encode('utf-8-sig');mime='text/csv';ext='csv'
    elif format=='tsv':content=df.to_csv(index=False,sep='\t').encode('utf-8-sig');mime='text/tab-separated-values';ext='tsv'
    elif format=='json':content=df.to_json(orient='records',date_format='iso',indent=2).encode();mime='application/json';ext='json'
    elif format=='xlsx':
        stream=io.BytesIO()
        with pd.ExcelWriter(stream,engine='xlsxwriter',datetime_format='yyyy-mm-dd') as writer:
            df.to_excel(writer,index=False,sheet_name='Data')
            p=basic_profile(df)
            pd.DataFrame(p['columns_info']).to_excel(writer,index=False,sheet_name='Data Dictionary')
            wb=writer.book;ws=writer.sheets['Data'];ws.freeze_panes(1,0)
            ws.autofilter(0,0,len(df),len(df.columns)-1)
            header_fmt=wb.add_format({'bold':True,'bg_color':'#17253B','font_color':'#FFFFFF','border':0})
            for i,col in enumerate(df.columns):ws.write(0,i,col,header_fmt);ws.set_column(i,i,min(max(len(col)+4,14),32))
        content=stream.getvalue();mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';ext='xlsx'
    elif format=='parquet':
        stream=io.BytesIO()
        try:df.to_parquet(stream,index=False)
        except ImportError:raise ValueError('Parquet export requires pyarrow. Install with: pip install pyarrow')
        content=stream.getvalue();mime='application/octet-stream';ext='parquet'
    elif format=='sqlite':
        with tempfile.NamedTemporaryFile(suffix='.sqlite',delete=False) as tmp:path=tmp.name
        try:
            conn=sqlite3.connect(path)
            try:df.to_sql('data',conn,index=False,if_exists='replace')
            finally:conn.close()
            content=Path(path).read_bytes()
        finally:Path(path).unlink(missing_ok=True)
        mime='application/vnd.sqlite3';ext='sqlite'
    else:raise ValueError('Choose CSV, TSV, JSON, XLSX, Parquet or SQLite')
    return Response(content,media_type=mime,headers={'Content-Disposition':f'attachment; filename="{name}.{ext}"'})

@app.get('/api/report')
def report():
    from html import escape
    df=store.get();result=auto_eda(df)
    p=result['profile'];name=escape(store.info[store.active]['name'])
    def t(rows):
        if not rows:return '<p>No values available.</p>'
        columns=list(rows[0]);head=''.join('<th>'+escape(str(c))+'</th>' for c in columns)
        body=''.join('<tr>'+''.join('<td>'+escape(str(row.get(c,'')))+'</td>' for c in columns)+'</tr>' for row in rows)
        return '<table><thead><tr>'+head+'</tr></thead><tbody>'+body+'</tbody></table>'
    info='<br>'.join(escape(i) for i in result['insights'])
    html=f'''<!DOCTYPE html><html><head><meta charset="utf-8"><title>{name} – EDA</title><style>
    body{{font:15px Segoe UI,Arial,sans-serif;background:#f4f7fb;color:#152135;max-width:1200px;margin:auto;padding:40px}}
    h1{{color:#172442}}h2{{margin-top:36px}}table{{border-collapse:collapse;width:100%;font-size:13px;background:white}}
    th,td{{border:1px solid #dfe6f1;padding:9px;text-align:left}}th{{background:#192d49;color:white}}
    .stat{{display:inline-block;margin:8px 12px 16px 0;padding:18px;background:white;border-radius:12px;min-width:140px}}
    .insights{{background:#eaf2ff;padding:20px;border-radius:14px;line-height:1.9}}@media print{{body{{background:white;padding:5px}}}}
    </style></head><body><h1>◈ InsightForge — Automated EDA</h1><p>Dataset: <b>{name}</b> | Exported {datetime.now().strftime('%d %b %Y %H:%M')}</p>
    <div class="stat"><b>{p['rows']:,}</b><br>Rows</div><div class="stat"><b>{p['columns']}</b><br>Columns</div>
    <div class="stat"><b>{p['missing_pct']}%</b><br>Missing</div><div class="stat"><b>{p['duplicates']:,}</b><br>Duplicates</div>
    <div class="stat"><b>{p['quality']}/100</b><br>Quality heuristic</div>
    <h2>Key insights</h2><div class="insights">{info}</div><h2>Column profile</h2>{t(p['columns_info'])}
    <h2>Numeric description</h2>{t(result['descriptive'])}<h2>Strongest correlations</h2>{t(result['strongest_correlations'])}
    <p><small>Exploratory summary, not a validated statistical or causal conclusion. Quality is a simple completeness/duplicate heuristic.</small></p></body></html>'''
    return Response(html,media_type='text/html',headers={'Content-Disposition':'attachment; filename="InsightForge_EDA_Report.html"'})

@app.get('/api/project')
def project_zip():
    buff=io.BytesIO()
    with zipfile.ZipFile(buff,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
        z.writestr('README.txt','InsightForge Studio local workspace backup. All datasets are exported as CSV and JSON; import to restore.\n')
        z.writestr('workspace_manifest.json',json.dumps(store.info,indent=2,default=str))
        for key,info in store.info.items():
            safe=re.sub('[^a-zA-Z0-9_]+','_',info['name'])[:55]
            df=store.get(key)
            z.writestr(f'datasets/{safe}_{key[:6]}.csv',df.to_csv(index=False))
            z.writestr(f'datasets/{safe}_{key[:6]}.json',df.to_json(orient='records',date_format='iso'))
    buff.seek(0)
    return StreamingResponse(buff,media_type='application/zip',headers={'Content-Disposition':'attachment; filename="InsightForge_Workspace_Backup.zip"'})

if __name__=='__main__':
    import uvicorn
    port=int(os.environ.get('INSIGHTFORGE_PORT','8765'))
    # The interface remains on this device only; no network-accessible listener.
    if os.environ.get('INSIGHTFORGE_NO_BROWSER')!='1':
        threading.Timer(1.8,lambda: webbrowser.open(f'http://127.0.0.1:{port}')).start()
    print(f'InsightForge Studio: http://127.0.0.1:{port}')
    print(f'Local workspace: {WORKSPACE}')
    uvicorn.run(app,host='127.0.0.1',port=port,log_level='warning')
