import numpy as np
import pandas as pd
import pytest

from analytics_core import apply_clean, auto_eda, calculate_column, chart, ml_train, run_sql, stat_analysis, pandas_transform

@pytest.fixture
def df():
    return pd.DataFrame({'x':[1,2,3,4,5,5,np.nan], 'y':[2,4,6,8,10,10,12],
                         'segment':['A','A','A','B','B','B','B'], 'text':[' Hi ','FOO','Bar',None,'yes','yes','yes']})

def test_cleaning_and_formulas(df):
    assert len(apply_clean(df,operation='drop_duplicates'))==6
    assert apply_clean(df,operation='fill_missing',columns=['x'],method='median').x.isna().sum()==0
    assert apply_clean(df,operation='text_transform',columns=['text'],method='strip').text.iloc[0]=='Hi'
    assert len(apply_clean(df,operation='filter',columns=['segment'],value='A',method='equals'))==3
    assert apply_clean(df,operation='outlier_iqr',columns=['x']).shape==df.shape
    assert apply_clean(df,operation='rename',columns=['x'],new_name='z').columns[0]=='z'
    assert 'derived' in calculate_column(df,'derived','x','multiply',constant=2).columns
    with pytest.raises(ValueError):
        apply_clean(df,operation='convert_type',columns=['x'],method='invalid')


def test_eda_and_visuals(df):
    e=auto_eda(df)
    assert e['profile']['missing']>=2
    assert len(e['descriptive'])==2
    assert len(e['strongest_correlations'])>=1
    for kind,params in [('histogram',{'x':'x'}),('scatter',{'x':'x','y':'y'}),('line',{'x':'x','y':'y'}),
                        ('bar',{'x':'segment','y':'y'}),('pie',{'x':'segment'}),('heatmap',{}),('box',{'x':'segment','y':'y'}),
                        ('violin',{'x':'segment','y':'y'}),('count',{'x':'segment'}),('area',{'x':'x','y':'y'}),
                        ('density',{'x':'x'}),('treemap',{'x':'segment'})]:
        fig=chart(df,kind,**params)
        assert fig.to_json()


def test_stats_and_sql(df):
    assert stat_analysis(df,'pearson','x','y')['statistic']>0.9
    assert stat_analysis(df,'ttest_ind','y','segment')['sample_size']>=6
    assert stat_analysis(df,'shapiro','x')['p_value'] is not None
    assert run_sql({'sales':df},'SELECT COUNT(*) AS n FROM sales','sales')['rows'][0]['n']==7
    with pytest.raises(ValueError):run_sql({'sales':df},'DROP TABLE sales','sales')
    with pytest.raises(ValueError):run_sql({'sales':df},'SELECT * FROM sales; DELETE FROM sales','sales')


def test_ml_regression_and_classification():
    rng=np.random.default_rng(12)
    n=110
    x=rng.uniform(-2,2,n)
    df=pd.DataFrame({'x':x,'city':rng.choice(['A','B'],n), 'y':4*x+rng.normal(0,.3,n), 'label':np.where(x>0,'positive','negative')})
    reg=ml_train(df[['x','city','y']],'y','random_forest','regression')
    assert reg['metrics']['r2']>.8
    cla=ml_train(df[['x','city','label']],'label','logistic_regression','classification')
    assert cla['metrics']['accuracy']>.8


def test_pandas_transform_recipes(df):
    g=pandas_transform(df,'groupby',group=['segment'],measure='y',agg='sum')
    assert len(g)==2 and 'y_sum' in g
    p=pandas_transform(df,'pivot',group=['segment'],pivot_column='text',measure='y',agg='sum')
    assert len(p)==2
    c=pandas_transform(df,'crosstab',group=['segment'],pivot_column='text')
    assert len(c)==2
    m=pandas_transform(df,'merge',right=pd.DataFrame({'code':['A','B'],'state':['North','South']}),group=['segment'],right_key='code')
    assert len(m)==len(df) and 'state' in m
    appended=pandas_transform(df,'concat',right=df.head(1))
    assert len(appended)==len(df)+1
    sampled=pandas_transform(df,'sample',n=3)
    assert len(sampled)==3
    r=pandas_transform(df,'rolling_mean',measure='y',window=3)
    assert 'y_rolling_3' in r.columns
