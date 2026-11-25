import io
import json
import os
import tempfile
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

os.environ['INSIGHTFORGE_HOME']=tempfile.mkdtemp(prefix='insightforge-test-')
from app import app

client=TestClient(app)

def check(response):
    assert response.status_code==200, (response.status_code,response.text[:500])
    return response.json()


def test_complete_user_journey():
    check(client.get('/api/health'))
    data=check(client.post('/api/demo'))
    assert len(data['imported'])==1
    state=check(client.get('/api/state'))
    assert state['profile']['rows']>=700
    assert state['profile']['missing']>0
    assert state['profile']['duplicates']>0
    first=check(client.get('/api/table?page_size=3'))
    assert len(first['rows'])==3
    assert first['columns'][0]=='Date'
    check(client.patch('/api/cell',json={'row':0,'column':'Region','value':'Test Location'}))
    edited=check(client.get('/api/table?search=Test%20Location'))
    assert edited['total']==1
    check(client.post('/api/undo'))
    assert check(client.get('/api/table?search=Test%20Location'))['total']==0
    check(client.post('/api/redo'))
    assert check(client.get('/api/table?search=Test%20Location'))['total']==1
    check(client.post('/api/undo'))
    check(client.post('/api/clean',json={'operation':'drop_duplicates'}))
    assert check(client.get('/api/state'))['profile']['duplicates']==0
    check(client.post('/api/clean',json={'operation':'fill_missing','columns':['Customer_Score'],'method':'median'}))
    assert check(client.get('/api/state'))['profile']['missing']==0
    check(client.post('/api/formula',json={'name':'Double_Revenue','a':'Revenue','op':'multiply','constant':2}))
    assert 'Double_Revenue' in check(client.get('/api/table'))['columns']
    transform=check(client.post('/api/transform',json={'operation':'groupby','group':['Region'],'measure':'Revenue','agg':'sum'}))
    assert transform['rows']==5
    original=next(d for d in check(client.get('/api/state'))['datasets'] if d['name']=='Retail Performance Demo')
    check(client.post('/api/select/'+original['id']))
    check(client.post('/api/clean',json={'operation':'convert_type','columns':['Campaign'],'method':'category'}))
    assert check(client.get('/api/eda'))['categorical']
    result=check(client.get('/api/eda'))
    assert result['descriptive']
    check(client.post('/api/chart',json={'kind':'histogram','x':'Revenue'}))
    resp=client.get('/api/chart/html');assert resp.status_code==200 and b'plotly' in resp.content
    resp=client.get('/api/chart/png');assert resp.status_code==200 and resp.content[:4]==b'\x89PNG'
    check(client.post('/api/stats',json={'test':'pearson','x':'Revenue','y':'Profit'}))
    ml=check(client.post('/api/ml',json={'target':'Revenue','task':'regression','algorithm':'random_forest'}))
    assert 'rmse' in ml['metrics']
    sql=check(client.post('/api/sql',json={'query':'SELECT COUNT(*) AS n FROM data'}))
    assert sql['rows'][0]['n']==700
    blocked=client.post('/api/sql',json={'query':'DROP TABLE data'})
    assert blocked.status_code==400
    for ext in ('csv','tsv','json','xlsx','sqlite'):
        r=client.get('/api/export/'+ext)
        assert r.status_code==200,(ext,r.text[:150] if ext=='json' else r.status_code)
        assert len(r.content)>100
    report=client.get('/api/report')
    assert report.status_code==200 and b'InsightForge' in report.content
    zipdata=client.get('/api/project')
    assert zipdata.status_code==200
    with zipfile.ZipFile(io.BytesIO(zipdata.content)) as z:
        assert any('.csv' in n for n in z.namelist())
    check(client.post('/api/reset'))
    assert check(client.get('/api/state'))['profile']['duplicates']>0


def test_import_variants():
    csv=b'name,value\nJohn,12\nJane,34\n'
    result=check(client.post('/api/import',files=[('files',('some.csv',csv,'text/csv'))]))
    assert len(result['imported'])==1
    assert check(client.get('/api/state'))['profile']['rows']==2
    pasted=check(client.post('/api/import-text',json={'text':'first,second\nA,B\n','name':'Pasted','format':'csv'}))
    assert pasted['imported']
    js=check(client.post('/api/import-text',json={'text':'[{"x":1},{"x":2}]','format':'json','name':'list'}))
    assert check(client.get('/api/state'))['profile']['rows']==2
    buff=io.BytesIO()
    with zipfile.ZipFile(buff,'w') as z:
        z.writestr('one.csv',csv)
        z.writestr('two.json','[{"name":"Alex","age":30}]')
    zipped=check(client.post('/api/import',files=[('files',('datasets.zip',buff.getvalue(),'application/zip'))]))
    assert len(zipped['imported'])==2
    before=len(check(client.get('/api/state'))['datasets'])
    current=check(client.get('/api/state'))['active']
    check(client.delete('/api/datasets/'+current))
    assert len(check(client.get('/api/state'))['datasets'])==before-1


def test_frontend_files():
    for p in ('/','/static/app.js','/static/styles.css','/static/vendor/plotly.min.js'):
        res=client.get(p)
        assert res.status_code==200
        assert len(res.content)>20
