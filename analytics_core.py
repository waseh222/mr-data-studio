"""Analytics functionality for InsightForge Studio.

All transforms are explicit. Imported files are data, never executed code.
"""
from __future__ import annotations

import io
import json
import math
import re
import sqlite3
from collections import Counter
from typing import Any

import numpy as np
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from plotly.subplots import make_subplots
from scipy import stats

PLOT_BG = '#0d1627'
PAPER_BG = '#101b2e'
TEXT = '#dfe9f8'
PALETTE = ['#7c78fa', '#31d6c4', '#f6b861', '#f47b9d', '#64b5f6', '#b6a4ff', '#a6e18b']


def native(v: Any):
    if v is None:
        return None
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating,)):
        return float(v) if np.isfinite(v) else None
    if isinstance(v, (np.bool_,)):
        return bool(v)
    if isinstance(v, (pd.Timestamp,)):
        return v.isoformat()
    if isinstance(v, (pd.Timedelta,)):
        return str(v)
    if isinstance(v, float) and not math.isfinite(v):
        return None
    if pd.isna(v) if np.isscalar(v) else False:
        return None
    return v


def records(df: pd.DataFrame, limit: int | None = None):
    if limit is not None:
        df = df.head(limit)
    return [{str(k): native(v) for k, v in d.items()} for d in df.to_dict('records')]


def clean_headers(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    seen: dict[str, int] = {}
    cols = []
    for i, c in enumerate(df.columns):
        base = str(c).strip() or f'Column_{i+1}'
        base = base[:120]
        count = seen.get(base, 0)
        name = base if count == 0 else f'{base}_{count+1}'
        while name in cols:
            count += 1
            name = f'{base}_{count+1}'
        seen[base] = count + 1
        cols.append(name)
    df.columns = cols
    return df.reset_index(drop=True)


def basic_profile(df: pd.DataFrame):
    n, c = df.shape
    missing = int(df.isna().sum().sum())
    possible = max(1, n * c)
    dup = int(df.duplicated().sum())
    num_cols = df.select_dtypes(include='number').columns.tolist()
    date_cols = df.select_dtypes(include='datetime').columns.tolist()
    cats = [x for x in df.columns if x not in num_cols + date_cols]
    quality = round(max(0.0, 100.0 * (1 - .7 * missing / possible - .3 * dup / max(1, n))), 1)
    mem = int(df.memory_usage(deep=True).sum())
    return {
        'rows': n, 'columns': c, 'missing': missing,
        'missing_pct': round(100 * missing / possible, 2),
        'duplicates': dup, 'numeric': len(num_cols), 'categorical': len(cats),
        'datetime': len(date_cols), 'memory_bytes': mem, 'quality': quality,
        'columns_info': [
            {'name': name, 'dtype': str(df[name].dtype), 'missing': int(df[name].isna().sum()),
             'missing_pct': round(100 * df[name].isna().mean(), 1) if n else 0,
             'unique': int(df[name].nunique(dropna=True)),
             'sample': [native(z) for z in df[name].dropna().head(3).tolist()]}
            for name in df.columns
        ],
    }


def auto_eda(df: pd.DataFrame):
    p = basic_profile(df)
    nums = df.select_dtypes(include=np.number)
    categoricals = df.select_dtypes(exclude=np.number)
    desc = []
    for col in nums.columns[:100]:
        s = pd.to_numeric(df[col], errors='coerce').dropna()
        desc.append({'column': col, 'count': int(s.size), 'mean': native(s.mean()) if s.size else None,
                     'median': native(s.median()) if s.size else None,
                     'std': native(s.std()) if s.size > 1 else None,
                     'min': native(s.min()) if s.size else None,
                     'p25': native(s.quantile(.25)) if s.size else None,
                     'p75': native(s.quantile(.75)) if s.size else None,
                     'max': native(s.max()) if s.size else None,
                     'skew': native(s.skew()) if s.size > 2 else None})
    cat_summary = []
    for col in categoricals.columns[:50]:
        vc = df[col].astype('string').fillna('(missing)').value_counts().head(8)
        cat_summary.append({'column': col, 'top_values': [{'value': str(k), 'count': int(v)} for k,v in vc.items()]})
    corr = nums.corr().replace([np.inf, -np.inf], np.nan).round(4) if not nums.empty else pd.DataFrame()
    strongest = []
    if corr.shape[0] >= 2:
        for i in range(len(corr.columns)):
            for j in range(i+1, len(corr.columns)):
                v = corr.iat[i,j]
                if pd.notna(v):
                    strongest.append({'a': corr.columns[i], 'b': corr.columns[j], 'r': round(float(v), 3)})
        strongest.sort(key=lambda v: abs(v['r']), reverse=True)
    insights = []
    if p['missing']:
        worst = sorted(p['columns_info'], key=lambda z: z['missing_pct'], reverse=True)[0]
        insights.append(f"{p['missing_pct']}% of cells are missing; '{worst['name']}' has the most missing values ({worst['missing_pct']}%).")
    else:
        insights.append('No missing values were detected.')
    if p['duplicates']:
        insights.append(f"{p['duplicates']:,} exact duplicate rows were detected.")
    if strongest:
        a = strongest[0]
        insights.append(f"Strongest numeric correlation: {a['a']} versus {a['b']} (r={a['r']}). Correlation does not prove causation.")
    if p['numeric']:
        insights.append(f"{p['numeric']} numeric fields are available for quantitative modeling and charts.")
    if not p['rows']:
        insights.append('This dataset has no rows. Import records to begin analysis.')
    return {'profile': p, 'descriptive': desc, 'categorical': cat_summary,
            'correlations': {'columns': corr.columns.tolist(), 'values': [[native(x) for x in row] for row in corr.to_numpy()]},
            'strongest_correlations': strongest[:12], 'insights': insights}


def apply_clean(df: pd.DataFrame, *, operation: str, columns: list[str] | None = None, value: Any = None,
                method: str | None = None, new_name: str | None = None) -> pd.DataFrame:
    columns = columns or []
    for col in columns:
        if col not in df.columns:
            raise ValueError(f'Column not found: {col}')
    out = df.copy()
    if operation == 'drop_duplicates':
        out = out.drop_duplicates(subset=columns or None, keep='first')
    elif operation == 'drop_missing_rows':
        out = out.dropna(subset=columns or None, how=method if method in ('all', 'any') else 'any')
    elif operation == 'drop_missing_columns':
        out = out.dropna(axis=1, how=method if method in ('all', 'any') else 'all')
    elif operation == 'fill_missing':
        target = columns or out.columns.tolist()
        mode = method or 'median'
        for col in target:
            s = out[col]
            if mode in ('mean','median'):
                if not pd.api.types.is_numeric_dtype(s):
                    raise ValueError(f'{mode} requires numeric column: {col}')
                replace = s.mean() if mode == 'mean' else s.median()
            elif mode == 'mode':
                m = s.mode(dropna=True)
                replace = m.iloc[0] if not m.empty else value
            elif mode == 'constant':
                replace = value
                if pd.api.types.is_numeric_dtype(s):
                    try: replace = float(value)
                    except (TypeError, ValueError): raise ValueError(f'Numeric column {col} requires a numeric fill value')
            elif mode == 'forward':
                out[col] = s.ffill(); continue
            elif mode == 'backward':
                out[col] = s.bfill(); continue
            else:
                raise ValueError('Unknown fill method')
            if pd.notna(replace):
                if isinstance(s.dtype, pd.CategoricalDtype) and replace not in s.cat.categories:
                    s = s.cat.add_categories([replace])
                out[col] = s.fillna(replace)
    elif operation == 'text_transform':
        if not columns: raise ValueError('Select text columns')
        op = method or 'strip'
        if op not in ('strip','lower','upper','title'): raise ValueError('Invalid text transformation')
        for col in columns:
            s = out[col].astype('string')
            out[col] = getattr(s.str, op)()
    elif operation == 'convert_type':
        if not columns: raise ValueError('Select columns')
        mode = method or 'numeric'
        for col in columns:
            if mode == 'numeric': out[col] = pd.to_numeric(out[col], errors='coerce')
            elif mode == 'datetime': out[col] = pd.to_datetime(out[col], errors='coerce')
            elif mode == 'text': out[col] = out[col].astype('string')
            elif mode == 'category': out[col] = out[col].astype('category')
            else: raise ValueError('Invalid target type')
    elif operation == 'outlier_iqr':
        if not columns: raise ValueError('Select numeric columns')
        for col in columns:
            if not pd.api.types.is_numeric_dtype(out[col]): raise ValueError(f'Numeric field required: {col}')
            q1, q3 = out[col].quantile([.25,.75]); iqr = q3-q1
            if pd.isna(iqr): continue
            lower, upper = q1-1.5*iqr, q3+1.5*iqr
            if method == 'remove': out = out[out[col].isna() | out[col].between(lower, upper)]
            else: out[col] = out[col].clip(lower,upper)
    elif operation == 'scale':
        if not columns: raise ValueError('Select numeric columns')
        for col in columns:
            s = pd.to_numeric(out[col], errors='coerce')
            if method == 'minmax':
                d = s.max() - s.min()
                out[col] = (s - s.min()) / (d if d else 1)
            else:
                sd = s.std()
                out[col] = (s - s.mean()) / (sd if pd.notna(sd) and sd else 1)
    elif operation == 'rename':
        if len(columns) != 1 or not new_name or not new_name.strip(): raise ValueError('Select one column and enter a new name')
        new_name = new_name.strip()
        if new_name in out.columns and new_name != columns[0]: raise ValueError('Column already exists')
        out.rename(columns={columns[0]: new_name}, inplace=True)
    elif operation == 'drop_columns':
        if not columns: raise ValueError('Select columns to remove')
        out.drop(columns=columns, inplace=True)
    elif operation == 'filter':
        if len(columns) != 1: raise ValueError('Select exactly one filter column')
        col = columns[0]
        operator = method or 'equals'
        val = value
        series = out[col]
        if operator in ('gt','gte','lt','lte'):
            if pd.api.types.is_numeric_dtype(series):
                try: val = float(val)
                except (TypeError,ValueError): raise ValueError('Numeric comparison requires numeric value')
            cmp = {'gt': lambda s,v:s>v,'gte':lambda s,v:s>=v,'lt':lambda s,v:s<v,'lte':lambda s,v:s<=v}[operator]
            mask = cmp(series, val)
        elif operator == 'contains': mask = series.astype('string').str.contains(str(val), case=False, regex=False, na=False)
        elif operator == 'not_equals': mask = series.astype(str) != str(val)
        elif operator == 'is_missing': mask = series.isna()
        elif operator == 'equals': mask = series.astype(str) == str(val)
        else: raise ValueError('Unsupported filter operator')
        out = out.loc[mask.fillna(False)]
    else:
        raise ValueError('Unsupported operation')
    return clean_headers(out)


def calculate_column(df: pd.DataFrame, name: str, a: str, op: str, b: str | None = None, constant: float | None = None):
    if not name or name in df.columns: raise ValueError('Enter an unused new column name')
    if a not in df.columns: raise ValueError('Source column not found')
    s = pd.to_numeric(df[a], errors='coerce')
    out = df.copy()
    other = pd.to_numeric(df[b], errors='coerce') if b and b in df else (float(constant) if constant is not None else None)
    if op in ('add','subtract','multiply','divide') and other is None: raise ValueError('Select a second column or a constant')
    if op == 'add': val = s + other
    elif op == 'subtract': val = s - other
    elif op == 'multiply': val = s * other
    elif op == 'divide': val = s / other
    elif op == 'log1p': val = np.log1p(s.where(s >= -1))
    elif op == 'sqrt': val = np.sqrt(s.where(s >= 0))
    elif op == 'percent_of_total': val = 100 * s / s.sum() if s.sum() else s*0
    elif op == 'cumulative_sum': val = s.cumsum()
    elif op == 'zscore': val = (s-s.mean())/(s.std() or 1)
    else: raise ValueError('Unsupported formula')
    out[name.strip()] = val.replace([np.inf,-np.inf], np.nan)
    return out


def theme(fig, title: str | None = None):
    fig.update_layout(paper_bgcolor=PAPER_BG, plot_bgcolor=PLOT_BG, font={'color':TEXT,'family':'Inter, Segoe UI, sans-serif','size':12},
                      title={'text':title or '', 'font':{'size':18}},
                      margin=dict(l=50,r=24,t=60,b=48), legend={'bgcolor':'rgba(0,0,0,0)'},
                      colorway=PALETTE)
    fig.update_xaxes(showgrid=True,gridcolor='#26344b',zerolinecolor='#26344b')
    fig.update_yaxes(showgrid=True,gridcolor='#26344b',zerolinecolor='#26344b')
    return fig


def chart(df: pd.DataFrame, kind: str, x: str | None = None, y: str | None = None, color: str | None = None,
          agg: str = 'count', bins: int = 30, title: str | None = None):
    if not len(df): raise ValueError('No rows to chart')
    if x and x not in df: raise ValueError('X column not present')
    if y and y not in df: raise ValueError('Y column not present')
    if color and color not in df: raise ValueError('Color column not present')
    if len(df) > 30_000: df = df.sample(30_000, random_state=42).sort_index()
    title = title or f'{kind.replace("_"," ").title()} Analysis'
    common = {'color':color, 'color_discrete_sequence':PALETTE}
    if kind == 'histogram':
        if not x: raise ValueError('Select X')
        fig = px.histogram(df, x=x, nbins=max(3,min(150,bins)), color=color, color_discrete_sequence=PALETTE, marginal='box')
    elif kind == 'scatter':
        if not x or not y: raise ValueError('Select X and Y')
        fig = px.scatter(df, x=x, y=y, **common, opacity=.78, hover_data=df.columns[:4])
    elif kind == 'line':
        if not x or not y: raise ValueError('Select X and Y')
        fig = px.line(df.sort_values(x).head(10_000), x=x, y=y, **common)
    elif kind == 'area':
        if not x or not y: raise ValueError('Select X and Y')
        fig = px.area(df.sort_values(x).head(10_000), x=x, y=y, **common)
    elif kind == 'box':
        if not y: raise ValueError('Select numeric Y')
        fig = px.box(df, x=x, y=y, color=color, color_discrete_sequence=PALETTE, points='outliers')
    elif kind == 'violin':
        if not y: raise ValueError('Select numeric Y')
        fig = px.violin(df, x=x, y=y, color=color, color_discrete_sequence=PALETTE, box=True)
    elif kind in ('bar', 'pie', 'count'):
        if not x: raise ValueError('Select X')
        group = [x] + ([color] if color and color != x and kind!='pie' else [])
        if kind=='count' or not y:
            sub = df.groupby(group, dropna=False, observed=True).size().reset_index(name='value')
        else:
            if not pd.api.types.is_numeric_dtype(df[y]): raise ValueError('Y must be numeric to aggregate')
            if agg not in ('mean','sum','median','min','max','count'): raise ValueError('Unsupported aggregation')
            sub = df.groupby(group, dropna=False, observed=True)[y].agg(agg).reset_index(name='value')
        sub = sub.sort_values('value', ascending=False).head(50)
        if kind == 'pie': fig = px.pie(sub, names=x, values='value', color_discrete_sequence=PALETTE, hole=.42)
        else: fig = px.bar(sub, x=x, y='value', color=(color if color in sub else None), color_discrete_sequence=PALETTE)
    elif kind == 'heatmap':
        numerics = df.select_dtypes(include=np.number)
        if numerics.shape[1] < 2: raise ValueError('At least two numeric columns required')
        correlation = numerics.corr().round(3)
        fig = px.imshow(correlation, text_auto='.2f', color_continuous_scale='RdBu_r', zmin=-1, zmax=1, aspect='auto')
    elif kind == 'density':
        if not x or not pd.api.types.is_numeric_dtype(df[x]): raise ValueError('Select numeric X')
        fig = px.histogram(df, x=x, histnorm='probability density', color=color, color_discrete_sequence=PALETTE, nbins=bins, marginal='rug')
    elif kind == 'scatter_3d':
        if not x or not y: raise ValueError('Select X and Y')
        numeric = df.select_dtypes(include='number').columns.tolist()
        z = next((col for col in numeric if col not in (x, y)), None)
        if not z: raise ValueError('Need a third numeric column')
        fig = px.scatter_3d(df.head(8_000),x=x,y=y,z=z,color=color,color_discrete_sequence=PALETTE)
    elif kind == 'treemap':
        if not x: raise ValueError('Select X')
        sub = df[x].fillna('(missing)').astype(str).value_counts().head(35).reset_index()
        sub.columns = ['label','value']
        fig = px.treemap(sub, path=['label'], values='value', color_discrete_sequence=PALETTE)
    else: raise ValueError('Unknown chart type')
    fig = theme(fig,title)
    return fig


def stat_analysis(df: pd.DataFrame, test: str, x: str, y: str | None = None):
    if x not in df: raise ValueError('X column required')
    if y and y not in df: raise ValueError('Y column not found')
    result: dict[str,Any] = {'test':test,'x':x,'y':y,'note':'Statistical significance does not establish causality.'}
    a = df[x]
    if test in ('pearson','spearman','kendall','linear_regression'):
        if not y: raise ValueError('Select Y')
        pair = pd.DataFrame({'x':pd.to_numeric(a, errors='coerce'),'y':pd.to_numeric(df[y], errors='coerce')}).replace([np.inf,-np.inf],np.nan).dropna()
        if len(pair)<3: raise ValueError('At least three valid paired observations required')
        if pair.x.nunique()<2 or pair.y.nunique()<2: raise ValueError('Both variables must vary')
        if test=='pearson': r,p = stats.pearsonr(pair.x,pair.y); result.update(statistic=float(r),p_value=float(p))
        elif test=='spearman': r,p = stats.spearmanr(pair.x,pair.y); result.update(statistic=float(r),p_value=float(p))
        elif test=='kendall': r,p = stats.kendalltau(pair.x,pair.y); result.update(statistic=float(r),p_value=float(p))
        else:
            reg=stats.linregress(pair.x,pair.y)
            result.update(statistic=float(reg.rvalue),p_value=float(reg.pvalue),slope=float(reg.slope),intercept=float(reg.intercept),r_squared=float(reg.rvalue**2),std_error=float(reg.stderr))
        result['sample_size'] = len(pair)
    elif test in ('ttest_ind','mannwhitney','anova','kruskal'):
        if not y: raise ValueError('Select grouping Y')
        tmp = pd.DataFrame({'value':pd.to_numeric(a,errors='coerce'),'group':df[y]}).dropna()
        groups = [g['value'].to_numpy(dtype=float) for _,g in tmp.groupby('group', observed=True) if len(g)>1]
        needed = 2 if test!='anova' and test!='kruskal' else 2
        if len(groups)<needed: raise ValueError('Need at least two groups with two or more observations each')
        if test in ('ttest_ind','mannwhitney') and len(groups)!=2: raise ValueError('This test requires exactly two groups')
        if test=='ttest_ind': s,p=stats.ttest_ind(*groups,equal_var=False)
        elif test=='mannwhitney': s,p=stats.mannwhitneyu(*groups,alternative='two-sided')
        elif test=='anova': s,p=stats.f_oneway(*groups)
        else: s,p=stats.kruskal(*groups)
        result.update(statistic=native(s),p_value=native(p),groups=len(groups),sample_size=sum(map(len,groups)))
    elif test == 'chi_square':
        if not y: raise ValueError('Select Y')
        ct = pd.crosstab(a,df[y])
        if ct.shape[0]<2 or ct.shape[1]<2: raise ValueError('Need at least two categories in both variables')
        chi,p,dof,expected=stats.chi2_contingency(ct)
        result.update(statistic=float(chi),p_value=float(p),degrees_of_freedom=int(dof),sample_size=int(ct.to_numpy().sum()),min_expected=float(expected.min()))
        if expected.min()<5: result['warning']='Some expected cell counts are below 5; chi-square approximation may be unreliable.'
    elif test == 'shapiro':
        a=pd.to_numeric(a,errors='coerce').dropna()
        if not 3<=len(a): raise ValueError('At least three observations required')
        if len(a)>5000: a=a.sample(5000,random_state=42); result['warning']='Shapiro-Wilk sampled 5,000 observations.'
        s,p=stats.shapiro(a)
        result.update(statistic=float(s),p_value=float(p),sample_size=len(a))
    else: raise ValueError('Unknown statistical test')
    if result.get('p_value') is not None:
        result['interpretation']='Evidence against the null hypothesis at α=0.05' if result['p_value']<.05 else 'Insufficient evidence against the null hypothesis at α=0.05'
    return result


def run_sql(frames: dict[str,pd.DataFrame], query: str, active: str, limit: int=1000):
    stripped = query.strip()
    if not re.match(r'^\s*(select|with)\b',stripped, re.I): raise ValueError('Read-only SELECT or WITH query required')
    if ';' in stripped.rstrip(';'): raise ValueError('Only one SQL statement is allowed')
    if limit<1 or limit>5000: raise ValueError('Result limit must be between 1 and 5,000')
    con=sqlite3.connect(':memory:')
    try:
        for table,frame in frames.items():
            frame.head(200_000).to_sql(table,con,index=False,if_exists='replace')
        if active in frames:
            frames[active].head(200_000).to_sql('data',con,index=False,if_exists='replace')
        con.execute('PRAGMA query_only = ON')
        cur=con.execute(f'SELECT * FROM ({stripped.rstrip(";")}) LIMIT ?', (limit,))
        cols=[d[0] for d in cur.description]
        rows=[dict(zip(cols,[native(v) for v in row])) for row in cur.fetchall()]
        return {'columns':cols,'rows':rows,'count':len(rows),'limit':limit,
                'tables':['data'] + list(frames)}
    except sqlite3.Error as e:
        raise ValueError(f'SQL error: {e}') from e
    finally:con.close()


def ml_train(df: pd.DataFrame, target: str, algorithm: str='random_forest', task: str='auto', test_fraction: float=.2):
    from sklearn.compose import ColumnTransformer
    from sklearn.impute import SimpleImputer
    from sklearn.linear_model import LinearRegression, LogisticRegression, Ridge
    from sklearn.ensemble import RandomForestClassifier,RandomForestRegressor,GradientBoostingClassifier,GradientBoostingRegressor
    from sklearn.metrics import accuracy_score,balanced_accuracy_score,f1_score,confusion_matrix,classification_report,mean_squared_error,mean_absolute_error,r2_score
    from sklearn.model_selection import train_test_split
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import OneHotEncoder,StandardScaler
    if target not in df: raise ValueError('Choose an existing target column')
    if len(df)<15: raise ValueError('At least 15 rows are required to train a model')
    if not .1<=test_fraction<=.4: raise ValueError('Test fraction must be 0.1–0.4')
    # Deterministic cap prevents unexpected memory/CPU exhaustion.
    frame=df.dropna(subset=[target]).sample(n=min(len(df.dropna(subset=[target])), 20_000),random_state=42).copy()
    X=frame.drop(columns=[target]); y=frame[target]
    if X.shape[1]==0: raise ValueError('At least one predictor is required')
    if task=='auto':
        task = 'classification' if (not pd.api.types.is_numeric_dtype(y) or y.nunique()<=15) else 'regression'
    if task not in ('classification','regression'): raise ValueError('Invalid learning task')
    if task=='classification':
        if y.nunique()>75: raise ValueError('More than 75 classes; choose a regression target or simplify categories')
        if y.nunique()<2: raise ValueError('Target needs at least two classes')
        counts=y.value_counts()
        if counts.min()<2: raise ValueError('Each target class needs at least two examples')
        allowed={'logistic_regression','random_forest','gradient_boosting'}
    else:
        y=pd.to_numeric(y,errors='coerce')
        mask=y.notna();X=X.loc[mask];y=y.loc[mask]
        if len(y)<15: raise ValueError('Too few valid target values')
        allowed={'linear_regression','ridge','random_forest','gradient_boosting'}
    if algorithm not in allowed: raise ValueError(f'Choose a {task} algorithm: {", ".join(sorted(allowed))}')
    for col in X.columns:
        if pd.api.types.is_datetime64_any_dtype(X[col]): X[col]=X[col].astype('string')
    num=X.select_dtypes(include='number').columns.tolist()
    cats=[c for c in X if c not in num]
    # Bound one-hot dimensions and avoid identifiers/high-cardinality text.
    excluded=[c for c in cats if X[c].nunique(dropna=True)>100]
    X=X.drop(columns=excluded)
    cats=[c for c in cats if c not in excluded]
    if not num and not cats: raise ValueError('No usable predictors; text/IDs with >100 distinct values are excluded')
    transformers=[]
    if num: transformers.append(('numeric',Pipeline([('impute',SimpleImputer(strategy='median')),('scale',StandardScaler())]),num))
    if cats: transformers.append(('categorical',Pipeline([('impute',SimpleImputer(strategy='most_frequent')),('encode',OneHotEncoder(handle_unknown='ignore',max_categories=30))]),cats))
    preprocess=ColumnTransformer(transformers)
    algos_class = {'logistic_regression':LogisticRegression(max_iter=700),
                   'random_forest':RandomForestClassifier(n_estimators=100,random_state=42,n_jobs=2,max_depth=12),
                   'gradient_boosting':GradientBoostingClassifier(random_state=42)}
    algos_reg = {'linear_regression':LinearRegression(),'ridge':Ridge(),
                 'random_forest':RandomForestRegressor(n_estimators=100,random_state=42,n_jobs=2,max_depth=12),
                 'gradient_boosting':GradientBoostingRegressor(random_state=42)}
    estimator=(algos_class if task=='classification' else algos_reg)[algorithm]
    stratify=y if task=='classification' and y.value_counts().min()>=3 and int(len(y)*test_fraction)>=y.nunique() else None
    xtrain,xtest,ytrain,ytest=train_test_split(X,y,test_size=test_fraction,random_state=42,stratify=stratify)
    pipeline=Pipeline([('preprocess',preprocess),('model',estimator)])
    pipeline.fit(xtrain,ytrain)
    pred=pipeline.predict(xtest)
    response={'task':task,'algorithm':algorithm,'target':target,'train_rows':len(xtrain),
              'test_rows':len(xtest),'predictors':num+cats,'excluded_high_cardinality':excluded,
              'disclaimer':'Exploratory holdout evaluation only. Check leakage, class imbalance, fairness, and external validation before operational use.'}
    if task=='classification':
        response['metrics']={'accuracy':float(accuracy_score(ytest,pred)),'balanced_accuracy':float(balanced_accuracy_score(ytest,pred)),
                             'weighted_f1':float(f1_score(ytest,pred,average='weighted',zero_division=0))}
        response['class_report']=classification_report(ytest,pred,output_dict=True,zero_division=0)
        labels=sorted(set(ytest)|set(pred),key=lambda x:str(x))
        response['confusion']={'labels':[str(x) for x in labels], 'values':confusion_matrix(ytest,pred,labels=labels).tolist()}
    else:
        response['metrics']={'r2':float(r2_score(ytest,pred)),'mae':float(mean_absolute_error(ytest,pred)),
                             'rmse':float(np.sqrt(mean_squared_error(ytest,pred)))}
        response['actual_vs_pred']=[{'actual':float(a),'predicted':float(b)} for a,b in list(zip(ytest,pred))[:500]]
    model=pipeline.named_steps['model']
    if hasattr(model,'feature_importances_'):
        names=pipeline.named_steps['preprocess'].get_feature_names_out()
        impacts=sorted(zip(names,model.feature_importances_),key=lambda pair:-pair[1])[:20]
        response['feature_importance']=[{'feature':str(k),'importance':float(v)} for k,v in impacts]
    return response


def pandas_transform(left: pd.DataFrame, operation: str, *, right: pd.DataFrame | None = None,
                     group: list[str] | None = None, measure: str | None = None,
                     agg: str = 'sum', pivot_column: str | None = None,
                     right_key: str | None = None, how: str = 'inner', n: int = 500,
                     window: int = 7) -> pd.DataFrame:
    """Auditable multi-table Pandas recipes, preserving source datasets."""
    group=group or []
    valid={'sum','mean','median','count','min','max','std','nunique'}
    if agg not in valid:raise ValueError('Unsupported aggregate method')
    for c in group:
        if c not in left:raise ValueError(f'Grouping field not found: {c}')
    if measure and measure not in left:raise ValueError('Measurement field not found')
    if operation=='groupby':
        if not group:raise ValueError('Select one or more group columns')
        if not measure:
            if agg not in ('count','nunique'):raise ValueError('Choose a measure column')
            out=left.groupby(group,dropna=False,observed=True).size().reset_index(name='row_count')
        else:
            out=left.groupby(group,dropna=False,observed=True)[measure].agg(agg).reset_index(name=f'{measure}_{agg}')
    elif operation=='pivot':
        if not group or not pivot_column or not measure:raise ValueError('Select row group, pivot field, and numeric measure')
        if pivot_column not in left:raise ValueError('Pivot field not found')
        # Guard against high-cardinality explosion into huge pivot tables.
        if left[pivot_column].nunique(dropna=True)>60:raise ValueError('Pivot field has more than 60 unique values')
        out=pd.pivot_table(left,index=group,columns=pivot_column,values=measure,aggfunc=agg,observed=True)
        out.columns=[str(c) if not isinstance(c,tuple) else '_'.join(map(str,c)) for c in out.columns]
        out=out.reset_index()
    elif operation=='crosstab':
        if len(group)!=1 or not pivot_column:raise ValueError('Choose exactly one row category and one column category')
        if pivot_column not in left:raise ValueError('Pivot category not found')
        out=pd.crosstab(left[group[0]],left[pivot_column],dropna=False).reset_index()
        out.columns=[str(x) for x in out.columns]
    elif operation=='merge':
        if right is None:raise ValueError('Choose another dataset')
        if len(group)!=1 or not right_key:raise ValueError('Choose a left and a right join key')
        if right_key not in right:raise ValueError('Right join column not found')
        if how not in ('inner','outer','left','right'):raise ValueError('Choose inner, outer, left or right merge')
        # Rough cap before allocating a potentially explosive many-to-many merge.
        a=left[group[0]].value_counts(dropna=False)
        b=right[right_key].value_counts(dropna=False)
        common=a.index.intersection(b.index)
        estimated=int(sum(int(a[k])*int(b[k]) for k in common))
        if estimated>MAX_PANDAS_RESULT_ROWS:raise ValueError(f'Merge would create approximately {estimated:,} matching rows. Aggregate or deduplicate join keys first.')
        out=left.merge(right,left_on=group[0],right_on=right_key,how=how,suffixes=('_left','_right'))
    elif operation=='concat':
        if right is None:raise ValueError('Select another dataset to append')
        out=pd.concat([left,right],ignore_index=True,sort=False)
    elif operation=='melt':
        if not group:raise ValueError('Select one or more identifier columns')
        out=pd.melt(left,id_vars=group,var_name='variable',value_name='value')
    elif operation=='sample':
        if not isinstance(n,int) or n<1:raise ValueError('Sample size must be positive')
        out=left.sample(n=min(n,len(left)),random_state=42).copy() if len(left) else left.copy()
    elif operation=='sort':
        if not group:raise ValueError('Select the sort columns')
        out=left.sort_values(group,ascending=how=='ascending',na_position='last')
    elif operation=='rolling_mean':
        if not measure:raise ValueError('Select a numeric measure')
        if window<2 or window>1000:raise ValueError('Window must be between 2 and 1,000')
        out=left.copy()
        if group:out=out.sort_values(group)
        out[f'{measure}_rolling_{window}']=pd.to_numeric(out[measure],errors='coerce').rolling(window,min_periods=1).mean()
    else:raise ValueError('Unsupported transformation')
    if len(out)>MAX_PANDAS_RESULT_ROWS or len(out.columns)>400:
        raise ValueError('Result too large. Filter, group, or sample first (limit 200,000 rows × 400 columns).')
    return clean_headers(out)

MAX_PANDAS_RESULT_ROWS=200_000
