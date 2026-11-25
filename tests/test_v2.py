import io
import json
import numpy as np
from fastapi.testclient import TestClient
from app import app, store, models, knowledge, WORKSPACE

client=TestClient(app)

def ok(r):
    assert r.status_code==200, (r.status_code,r.text[:1200]);return r.json()

def test_v2_static_and_workspaces():
    assert WORKSPACE.exists()
    h=ok(client.get('/api/health'))
    assert h['version']=='2.0.0'
    for path in ('/static/studio_v2.js','/static/studio_v2.css','/static/app.js','/'):
        r=client.get(path);assert r.status_code==200 and len(r.content)>120
    assert b'Analysis Workbench' in client.get('/').content

def test_guided_analysis_all_recipes():
    ok(client.post('/api/demo'))
    for kind in ('auto','missing','overview','category','trend','distribution','correlation','scatter','outliers'):
        res=ok(client.post('/api/analyze',json={'kind':kind}))
        assert len(res['panels'])>=1
        assert len(res['insights'])>=1 or kind=='scatter'
        assert any(p['figure'] is not None for p in res['panels'])
    explicit=ok(client.post('/api/analyze',json={'kind':'category','x':'Region','y':'Revenue'}))
    assert explicit['panels'][0]['rows']
    report=client.post('/api/analyze/report',json={'kind':'category','x':'Region','y':'Revenue'})
    assert report.status_code==200 and b'InsightForge Guided Analytics' in report.content
    assert b'plotly' in report.content
    invalid=client.post('/api/analyze',json={'kind':'trend','x':'bogus'})
    assert invalid.status_code==400

def test_classification_manual_prediction_and_deletion():
    # Synthetic data with a clearly predictive signal, not an uploaded real-world dataset.
    rng=np.random.default_rng(4)
    buf=io.StringIO();buf.write('income,tenure,group,decision\n')
    for i in range(105):
        inc=int(rng.integers(10,101));ten=int(rng.integers(1,11))
        label='yes' if inc>53 else 'no'
        buf.write(f'{inc},{ten},{"A" if i%2 else "B"},{label}\n')
    ok(client.post('/api/import-text',json={'name':'Model Test Data','format':'csv','text':buf.getvalue()}))
    trained=ok(client.post('/api/models/train',json={'target':'decision','algorithm':'random_forest',
                 'task':'classification','test_fraction':.2,'features':['income','tenure','group']}))
    assert 0<=trained['metrics']['accuracy']<=1
    assert trained['test_rows']>0
    assert trained['inputs']
    assert trained['task']=='classification'
    prediction=ok(client.post('/api/models/'+trained['id']+'/predict',json={'values':{'income':72,'tenure':5,'group':'B'}}))
    assert prediction['prediction'] in ('yes','no')
    assert abs(sum(p['probability'] for p in prediction['probabilities'])-1)<.00001
    saved=ok(client.get('/api/models'))['models']
    assert any(m['id']==trained['id'] for m in saved)
    models.cache.clear() # exercise persistence across process restart
    assert ok(client.post('/api/models/'+trained['id']+'/predict',json={'values':{'income':12,'tenure':1,'group':'A'}}))['prediction'] in ('no','yes')
    assert ok(client.get('/api/models/'+trained['id']))['id']==trained['id']
    ok(client.delete('/api/models/'+trained['id']))
    assert client.post('/api/models/'+trained['id']+'/predict',json={'values':{'income':2}}).status_code==400


def test_regression_and_rag_retrieval():
    rng=np.random.default_rng(11)
    buf=io.StringIO();buf.write('units,discount,total\n')
    for i in range(70):
        u=float(rng.integers(1,45));d=int(i%5)
        buf.write(f'{u},{d},{u*20-d*2:.2f}\n')
    ok(client.post('/api/import-text',json={'name':'Regression Examples','format':'csv','text':buf.getvalue()}))
    trained=ok(client.post('/api/models/train',json={'target':'total','algorithm':'ridge','task':'regression',
                      'test_fraction':.2}))
    assert 'r2' in trained['metrics'] and 'mae' in trained['metrics']
    assert 'accuracy' not in trained['metrics']
    prediction=ok(client.post('/api/models/'+trained['id']+'/predict',json={'values':{'units':7,'discount':1}}))
    assert isinstance(prediction['prediction'],float)
    ok(client.delete('/api/models/'+trained['id']))
    added=ok(client.post('/api/knowledge/import',files=[('files',('notes.txt',b'Pandas is used for cleaning tables. Missing values can be imputed with the median to preserve rows. Model training uses a separate holdout dataset.','text/plain'))]))
    assert added['imported'][0]['chunks']>=1
    res=ok(client.post('/api/knowledge/ask',json={'question':'How can missing values be imputed?','mode':'retrieve'}))
    assert 'median' in res['answer'].lower()
    assert res['mode']=='retrieval_only'
    assert res['passages']
    ok(client.delete('/api/knowledge/'+added['imported'][0]['id']))
    assert ok(client.get('/api/knowledge'))['documents']==[]


def test_genai_service_returns_connection_state_without_contacting_cloud():
    resp=ok(client.get('/api/ollama/models'))
    assert isinstance(resp['connected'],bool)
    bad=client.post('/api/ollama/chat',json={'prompt':'hello','model':'invalid;command','use_data':False})
    assert bad.status_code==400
