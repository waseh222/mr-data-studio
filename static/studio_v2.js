/* InsightForge v2 — accessible no-code workbench, persistent ML, local GenAI and lessons. */
const PLUS = {
  recipe:'auto', analysis:null, models:[], activeModel:'', currentModel:null, latestPrediction:null,
  documents:[], ollama:{connected:false,models:[]},lesson:0,answer:null,
  done:JSON.parse(localStorage.getItem('insightforge_lessons')||'[]'),working:false
};
function plusAlert(message){toast(message,true)}
function enhanceOverview(){
 const target=root();if(!target||target.querySelector('.studio-hero'))return;
 const banner=`<div class="studio-hero"><div><div class="eyebrow">YOUR DATA SCIENCE COMMAND CENTER</div><h2>From dataset to insight — in a few clicks.</h2><p>Guided visual analysis, editable datasets, predictive AI with a live testing console, local document Q&A, and hands-on learning. No code required.</p><div class="hero-action-row"><button class="button" onclick="show('analyst')">▶ Start Analysis</button><button class="button" onclick="show('ml')">◉ Build a Model</button><button class="button" onclick="show('academy')">✎ Guided Lessons</button></div></div><div style="font-size:66px;opacity:.3">◈</div></div>
 <div class="action-grid">${[
 ['◫','Quick Analysis','Auto charts + meaningful findings','analyst'],
 ['✦','Clean Dataset','Fix empty cells and duplicates','clean'],
 ['◉','Model Builder','Train, score, manually predict','ml'],
 ['✳','Generative AI','Local chat + document knowledge','genai']
 ].map(i=>`<button class="action-card" onclick="show('${i[3]}')"><span class="action-icon">${i[0]}</span><span><strong>${i[1]}</strong><span>${i[2]}</span></span></button>`).join('')}</div>`;
 target.insertAdjacentHTML('afterbegin',banner);
}
const RECIPES=[
 ['auto','✦ Auto analysis','A set of charts and plain-language findings'],
 ['overview','▤ Data quality','Inspect missing values and duplicate records'],
 ['category','▥ Group compare','Compare counts or averages by category'],
 ['trend','⌁ Time trends','See how totals move over time'],
 ['distribution','◍ Distribution','Understand spread and shape'],
 ['correlation','▦ Relationships','Compare numeric variables'],
 ['scatter','⠿ Scatter plot','Compare two numeric variables'],
 ['outliers','◇ Outlier scan','Find unusual numeric values']
];
function viewAnalyst(){
 root().innerHTML=title('Analysis Workbench','A guided, no-code experience: choose an analytical question, press one button, and inspect the real results.',`<button class="button ghost sm" onclick="show('eda')">View full EDA</button><button class="button primary sm" onclick="runGuided()">▶ Analyze Now</button>`)+
 `<div class="card card-pad" style="margin-bottom:18px"><div class="section-eyebrow">STEP 1 · WHAT WOULD YOU LIKE TO EXPLORE?</div><div class="recipe-tabs">${RECIPES.map(r=>`<button class="recipe-button ${PLUS.recipe===r[0]?'active':''}" onclick="chooseRecipe('${r[0]}')">${r[1]}</button>`).join('')}</div><p class="tiny-note">${esc((RECIPES.find(r=>r[0]===PLUS.recipe)||RECIPES[0])[2])}. Automatic mode detects useful numeric, categorical, and date fields.</p>
 <div class="fields cols-3 section-gap">${field('Category / X axis',select('guided-x',cols(),'', 'Automatic / choose'))}${field('Numeric / Y axis',select('guided-y',nums(),'', 'Automatic / choose'))}${field('Group by field',select('guided-group',cols(),'', 'Automatic / choose'))}</div>
 <div class="form-actions"><button class="button primary" id="analyze-now" onclick="runGuided()">▶ Run Analysis</button><button class="button ghost" onclick="runAutoDashboard()">✧ Create Auto Dashboard</button><button class="button ghost" onclick="exportGuidedReport()">⇩ Export HTML Report</button></div></div>
 <div id="guided-results">${PLUS.analysis?'':'<div class="analytics-panel"><div class="empty-mini">Select an analysis recipe and press Run Analysis. The results will be calculated from your dataset, not sample placeholders.</div></div>'}</div>`;
 if(PLUS.analysis)renderGuided(PLUS.analysis);
}
function chooseRecipe(recipe){PLUS.recipe=recipe;viewAnalyst();}
async function runAutoDashboard(){PLUS.recipe='auto';viewAnalyst();await runGuided();}
async function runGuided(){const btn=el('analyze-now');if(btn){btn.disabled=true;btn.textContent='Analyzing…';}
 try{const r=await api('analyze','POST',{kind:PLUS.recipe,x:val('guided-x')||null,y:val('guided-y')||null,group:val('guided-group')||null});PLUS.analysis=r;renderGuided(r);toast('Analysis complete — real data, interactive charts.');}
 catch(e){noteError(e)}finally{if(btn){btn.disabled=false;btn.textContent='▶ Run Analysis';}}
}
async function exportGuidedReport(){
 if(!hasData())return plusAlert('Load a dataset before exporting analysis');
 try{
 const response=await fetch('/api/analyze/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:PLUS.recipe,x:val('guided-x')||null,y:val('guided-y')||null,group:val('guided-group')||null})});
 if(!response.ok){const error=await response.json();throw new Error(error.detail||'Report export failed');}
 const file=await response.blob();const url=URL.createObjectURL(file);
 const a=document.createElement('a');a.href=url;a.download='InsightForge_Guided_Analysis.html';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);
 toast('Standalone HTML analysis report exported.');
 }catch(e){noteError(e)}
}
function renderGuided(r){const target=el('guided-results');if(!target)return;
 target.innerHTML=`<div class="card card-pad" style="margin-bottom:18px"><div class="section-eyebrow">YOUR ANALYSIS SUMMARY</div><div class="metric-ribbon"><div class="metric-tile"><small>Rows analyzed</small><b>${fmt(r.rows_analyzed)}</b><p>From your current dataset</p></div><div class="metric-tile"><small>Insight panels</small><b>${r.panels.length}</b><p>Directly computed</p></div><div class="metric-tile"><small>Recipe</small><b style="font-size:17px">${esc(r.recipe.toUpperCase())}</b><p>Change it above any time</p></div></div><div class="section-gap">${r.insights.map(i=>`<div class="insight-chip">✦ ${esc(i)}</div>`).join('')||'<div class="insight-chip">Explore the charts and the data tables below.</div>'}</div><p class="tiny-note">${esc(r.note)}</p></div>
 ${r.panels.map((p,i)=>`<div class="analytics-panel"><div class="card-head"><div><h3>${esc(p.title)}</h3><p>${esc(p.description)}</p></div><span class="tag">${esc(p.kind)}</span></div><div class="plot" style="min-height:350px" id="guided-plot-${i}"></div>${p.rows?.length?`<details class="section-gap"><summary style="cursor:pointer;font-size:12px;font-weight:700;color:var(--violet)">Show exact analysis table (${p.rows.length} rows)</summary><div class="section-gap">${formatTable(p.rows)}</div></details>`:''}</div>`).join('')}`;
 r.panels.forEach((p,i)=>{if(p.figure){Plotly.react('guided-plot-'+i,p.figure.data,p.figure.layout,{responsive:true,displaylogo:false})}else{el('guided-plot-'+i).innerHTML='<div class="empty-mini">No chart available for this result</div>';}});
}
function modelMetric(r){
 if(r.task==='classification')return {name:'TEST ACCURACY',value:(100*r.metrics.accuracy).toFixed(1)+'%',sub:'Correct predictions on untouched test rows'};
 return {name:'TEST R²',value:fmt(r.metrics.r2),sub:'Regression score (R² is not classification accuracy)'};
}
function viewMLV2(){
 const good=hasData(),options=cols();
 root().innerHTML=title('Model Builder','Train scikit-learn models, review genuine test scores, then type values in the left panel to make manual predictions.',`<span class="tag cyan">LOCAL ML · NO CODE</span>`)+
 `<div class="wizard-steps"><span class="wizard-step active">1 · Choose target</span><span class="wizard-step">2 · Select model</span><span class="wizard-step">3 · Train & score</span><span class="wizard-step">4 · Test manually</span></div>
 <div class="ml-layout"><div class="ml-side-panel"><div class="section-eyebrow">LIVE MODEL TESTER</div><h2>Test a prediction</h2><p class="tiny-note">Enter real input values below. Each prediction is generated by your trained scikit-learn pipeline.</p>
 ${field('Saved trained model',`<select class="select" id="saved-model" onchange="selectTrainedModel(this.value)"><option value="">Choose saved model…</option></select>`)}
 <div id="predict-form"><div class="empty-mini" style="padding:30px 10px">Train a model or choose a saved model to unlock manual input fields.</div></div><div id="predict-out"></div>
 <div class="side-help">Prediction confidence, when available, is a model-estimated probability, <b>not</b> a guarantee of correctness. Use only for learning and exploratory analytics.</div></div>
 <div><div class="card card-pad"><div class="card-head"><div><h2>Train a new predictive model</h2><p>Guided preprocessing, holdout evaluation, and optional 3-fold cross-validation</p></div><span class="tag">SCIKIT-LEARN</span></div>
 ${good?`<div class="fields cols-2">${field('What do you want to predict? (target)',select('model-target',options,'','Select the outcome column…').replace('id="model-target"','id="model-target" onchange="syncModelOptions()"'))}${field('Learning problem',`<select class="select" id="model-task" onchange="syncModelOptions()"><option value="auto">Detect automatically</option><option value="classification">Classification — labels</option><option value="regression">Regression — numbers</option></select>`)}
 ${field('Algorithm',`<select class="select" id="model-algorithm">${modelAlgorithms('auto')}</select>`)}${field('Test dataset size',`<select class="select" id="model-test"><option value="0.2">20% test data</option><option value="0.25">25% test data</option><option value="0.3">30% test data</option></select>`)}</div>
 <details class="section-gap"><summary style="cursor:pointer;color:var(--violet);font-size:12px;font-weight:750">Advanced · Select input columns</summary><p class="tiny-note">By default all fields except your target are used. Deselect possible IDs, future indicators and other leakage fields.</p><div class="column-list" id="model-features">${options.map(c=>`<label class="check-item" style="padding:9px"><input type="checkbox" value="${esc(c)}" checked>${esc(c)}</label>`).join('')}</div></details>
 <div class="form-actions"><button class="button primary" id="model-train" onclick="trainAdvancedModel()">◉ Train & Evaluate</button><button class="button ghost" onclick="show('academy')">Learn ML First</button></div>`:
 `<div class="notice warning">Import or select a dataset before training. Previously saved models can still be tested here.</div><button class="button primary" onclick="show('import')">＋ Import Data</button>`}
 <div class="notice warning section-gap">Classification shows <b>holdout accuracy (%)</b>. Regression shows <b>R², MAE and RMSE</b> because regression does not have a standard accuracy percentage. Check leakage and external validity.</div></div>
 <div class="card card-pad section-gap"><div class="card-head"><div><h2>Model evaluation</h2><p>Scores, diagnostic plots, feature importance and test set sizes</p></div></div><div id="advanced-model-metrics">${PLUS.currentModel?renderMLMetrics(PLUS.currentModel):'<div class="empty-mini">Your holdout metrics will appear here after training or selecting a saved model.</div>'}</div><div class="plot" id="advanced-model-chart" style="min-height:300px"></div></div>
 <div class="card card-pad section-gap">${cardTitle('Model library','Previously trained models are saved on your computer')}<div id="advanced-model-list"><div class="empty-mini">Loading saved models…</div></div></div></div></div>`;
 syncModelOptions();loadSavedModels();if(PLUS.currentModel)drawModelDiagnostics(PLUS.currentModel);
}
function modelAlgorithms(task){
 const base=[['random_forest','Random Forest'],['gradient_boosting','Gradient Boosting'],['extra_trees','Extra Trees'],['decision_tree','Decision Tree'],['knn','K-Nearest Neighbors']];
 const extra=task==='regression'?[['linear_regression','Linear Regression'],['ridge','Ridge Regression']]:[['logistic_regression','Logistic Regression']];
 return [...base,...extra].map(x=>`<option value="${x[0]}">${x[1]}</option>`).join('');
}
function syncModelOptions(){
 let task=val('model-task');
 if(task==='auto'){
  const target=val('model-target');const info=A.state?.profile?.columns_info?.find(c=>c.name===target);
  if(info)task=(!/int|float|double|number/i.test(info.dtype)||info.unique<=15)?'classification':'regression';
 }
 const sel=el('model-algorithm');if(!sel)return;const old=sel.value;sel.innerHTML=modelAlgorithms(task);if([...sel.options].some(o=>o.value===old))sel.value=old;
 document.querySelectorAll('#model-features input').forEach(e=>{if(e.value===val('model-target')){e.checked=false;e.disabled=true;}else{e.disabled=false;}});
}
function renderMLMetrics(r){const h=modelMetric(r);
 const entries=Object.entries(r.metrics).filter(z=>z[0]!==('classification'===r.task?'accuracy':'r2'));
 return `<div class="metric-ribbon"><div class="metric-tile" style="border-color:var(--cyan)"><small>${esc(h.name)}</small><b>${esc(h.value)}</b><p>${esc(h.sub)}</p></div>${entries.map(([k,v])=>`<div class="metric-tile"><small>${esc(k.replaceAll('_',' '))}</small><b>${['weighted_f1','balanced_accuracy','weighted_precision','weighted_recall'].includes(k)?(100*v).toFixed(1)+'%':fmt(v)}</b><p>On the held-out test set</p></div>`).join('')}</div>
 <div class="table-meta"><span>Algorithm: <b>${esc(r.algorithm.replaceAll('_',' '))}</b></span><span>Train: ${fmt(r.train_rows)} rows</span><span>Test: ${fmt(r.test_rows)} rows</span></div>
 ${r.cv?`<div class="insight-chip">3-fold cross-validation on training data: ${esc(r.cv.metric.toUpperCase())} mean ${r.task==='classification'?(100*r.cv.mean).toFixed(1)+'%':fmt(r.cv.mean)} ± ${r.task==='classification'?(100*r.cv.std).toFixed(1)+'%':fmt(r.cv.std)}.</div>`:''}
 ${r.excluded_high_cardinality?.length?`<div class="notice warning section-gap">Excluded high-cardinality text: ${esc(r.excluded_high_cardinality.join(', '))}</div>`:''}
 <p class="tiny-note section-gap">${esc(r.disclaimer)}</p>`;
}
async function loadSavedModels(){
 try{PLUS.models=(await api('models')).models;const sel=el('saved-model');if(!sel)return;
  const id=PLUS.activeModel;
  sel.innerHTML=option('','Choose saved model…')+PLUS.models.map(m=>option(m.id,`${m.target} · ${m.algorithm.replaceAll('_',' ')} · ${m.created}`,m.id===id)).join('');
  if(id&&PLUS.models.some(m=>m.id===id)){sel.value=id;renderManualPredictor(PLUS.models.find(m=>m.id===id));}
  else if(PLUS.models.length){PLUS.activeModel=PLUS.models[0].id;sel.value=PLUS.activeModel;PLUS.currentModel=PLUS.models[0];renderManualPredictor(PLUS.models[0]);}
  const list=el('advanced-model-list');if(list)list.innerHTML=PLUS.models.length?PLUS.models.map(m=>{
   const score=modelMetric(m);return `<div class="model-list-row"><div><b>${esc(m.target)} · ${esc(m.algorithm.replaceAll('_',' '))}</b><div class="tiny-note">${esc(m.created)} · ${esc(m.task)} · ${esc(score.name)} <span class="model-score">${esc(score.value)}</span></div></div><div class="feature-bar"><button class="button sm ghost" onclick="selectTrainedModel('${m.id}')">Open</button><button class="button sm destructive" onclick="deleteTrainedModel('${m.id}')">Delete</button></div></div>`;
  }).join(''):'<div class="empty-mini">No models yet. Train your first model above.</div>';
 }catch(e){noteError(e)}
}
function renderManualPredictor(m){const box=el('predict-form');if(!box)return;
 box.innerHTML=`<div class="tag cyan" style="margin:12px 0">${esc(m.task.toUpperCase())}</div><p class="tiny-note">Predict <b>${esc(m.target)}</b> using ${m.inputs.length} field(s).</p><div style="max-height:52vh;overflow:auto;padding:2px 4px 10px 0">${m.inputs.map((f,i)=>`<div class="predict-field"><label>${esc(f.name)}</label>${f.kind==='categorical'?`<select class="select predict-input" data-name="${esc(f.name)}">${(f.options||[]).map(v=>option(v,v,v===String(f.sample))).join('')}<option value="">(missing)</option></select>`:`<input class="input predict-input" type="number" step="any" data-name="${esc(f.name)}" value="${f.sample==null?'':esc(f.sample)}" placeholder="Numeric value">`}</div>`).join('')}</div><button class="button primary" style="width:100%" id="predict-button" onclick="predictManually()">▶ Predict With These Values</button><button class="button ghost sm" style="width:100%;margin-top:9px" onclick="resetModelSamples()">↻ Restore Example Values</button>`;
 el('predict-out').innerHTML='';
}
function resetModelSamples(){const m=PLUS.models.find(x=>x.id===PLUS.activeModel);if(m)renderManualPredictor(m)}
async function selectTrainedModel(id){PLUS.activeModel=id;const m=PLUS.models.find(x=>x.id===id);if(!m)return;
 PLUS.currentModel=m;const s=el('saved-model');if(s)s.value=id;
 renderManualPredictor(m);const target=el('advanced-model-metrics');if(target)target.innerHTML=renderMLMetrics(m);drawModelDiagnostics(m);
}
async function trainAdvancedModel(){const target=val('model-target');if(!target)return plusAlert('Choose the target field you want to predict');
 const btn=el('model-train');btn.disabled=true;btn.textContent='Training…';
 try{
  const choices=[...document.querySelectorAll('#model-features input:checked')].map(x=>x.value).filter(c=>c!==target);
  const r=await api('models/train','POST',{target,task:val('model-task'),algorithm:val('model-algorithm'),test_fraction:Number(val('model-test')),features:choices});
  PLUS.activeModel=r.id;PLUS.currentModel=r;el('advanced-model-metrics').innerHTML=renderMLMetrics(r);
  drawModelDiagnostics(r);await loadSavedModels();toast('Model trained and saved. Use the left panel to test it manually!');
 }catch(e){noteError(e)}finally{btn.disabled=false;btn.textContent='◉ Train & Evaluate';}
}
function drawModelDiagnostics(r){if(!el('advanced-model-chart'))return;
 if(r.feature_importance?.length){const list=r.feature_importance.slice(0,15).reverse();plot('advanced-model-chart',[{type:'bar',orientation:'h',x:list.map(z=>z.importance),y:list.map(z=>z.feature),marker:{color:'#129ca2'}}],{margin:{l:175,r:15,t:18,b:42},xaxis:{title:'Relative feature importance'}})}
 else if(r.confusion){plot('advanced-model-chart',[{type:'heatmap',x:r.confusion.labels,y:r.confusion.labels,z:r.confusion.values,colorscale:'Blues'}],{xaxis:{title:'Predicted category'},yaxis:{title:'Actual category'}})}
 else if(r.actual_vs_pred?.length){plot('advanced-model-chart',[{type:'scatter',mode:'markers',x:r.actual_vs_pred.map(z=>z.actual),y:r.actual_vs_pred.map(z=>z.predicted),marker:{opacity:.65,color:'#356bda'}}],{xaxis:{title:'Actual value'},yaxis:{title:'Predicted value'}})}
 else el('advanced-model-chart').innerHTML='<div class="empty-mini">No diagnostic plot for this model.</div>';
}
async function predictManually(){if(!PLUS.activeModel)return plusAlert('Choose a saved model first');
 const values={};document.querySelectorAll('.predict-input').forEach(e=>{values[e.dataset.name]=e.value});
 const btn=el('predict-button');btn.disabled=true;btn.textContent='Predicting…';
 try{const r=await api('models/'+PLUS.activeModel+'/predict','POST',{values});PLUS.latestPrediction=r;
  const t=el('predict-out');t.innerHTML=`<div class="prediction-result"><div class="section-eyebrow">PREDICTION RESULT</div><h3>${esc(String(r.prediction))}</h3><p class="tiny-note">Predicted ${esc(r.target)} · ${esc(r.task)}</p>${r.probabilities.map(p=>`<div class="prob-row"><b>${esc(p.class)}</b> <span style="float:right">${(p.probability*100).toFixed(1)}%</span><div class="mini-bar"><span style="width:${Math.min(100,100*p.probability)}%"></span></div></div>`).join('')}</div>`;
  toast('Manual prediction generated');
 }catch(e){noteError(e)}finally{btn.disabled=false;btn.textContent='▶ Predict With These Values';}
}
async function deleteTrainedModel(id){if(!confirm('Delete this saved model? This does not delete any dataset.'))return;
 try{await api('models/'+id,'DELETE');if(PLUS.activeModel===id){PLUS.activeModel='';PLUS.currentModel=null;}viewMLV2();toast('Saved model deleted');}catch(e){noteError(e)}
}
function viewGenAI(){
 root().innerHTML=title('Generative AI Studio','Use local Ollama models to ask questions, draft analysis explanations, explore prompts, and discuss a sampled dataset.',`<span class="tag cyan">LOCAL MODEL · NO API KEY</span>`)+
 `<div class="studio-hero" style="padding:23px"><div><div class="eyebrow">GENERATIVE AI WORKSHOP</div><h2>Your data, your local language model.</h2><p>Works with Ollama models installed on this PC. Unlike a demo chatbot, questions are sent to a real model running locally.</p></div><button class="button" onclick="refreshLocalModels()">↻ Check Ollama</button></div>
 <div class="grid grid-narrow"><div><div class="card card-pad">${cardTitle('AI chat workspace','Generate explanations or help with a data-science task')}
 <div class="section-eyebrow">QUICK PROMPT STARTERS</div><div class="feature-bar">${[
 ['Explain EDA','Explain how I should explore this data, step by step, for a beginner.'],
 ['Find issues','Explain what missing data, outliers, and duplicates mean and how to handle them.'],
 ['Build ML plan','Recommend a sensible model validation workflow with leakage checks.'],
 ['Explain statistics','Teach the difference between correlation and causation with an example.']
 ].map(a=>`<button class="button ghost sm" onclick="usePrompt('${esc(a[1])}')">${esc(a[0])}</button>`).join('')}</div>
 ${field('Ask a question / write a prompt',`<textarea id="genai-prompt" class="textarea" rows="6" placeholder="Ask how to analyze your data, interpret a chart, or use Python tools…"></textarea>`)}
 <label class="check-item"><input type="checkbox" id="genai-context" ${hasData()?'checked':'disabled'}> Include an 8-row sample of the current dataset as context</label>
 <div class="form-actions"><button class="button primary" id="genai-send" onclick="sendLocalPrompt()">✳ Generate With Local AI</button><button class="button ghost" onclick="show('knowledge')">Open Document RAG</button></div>
 <div class="section-gap" id="genai-output"><div class="empty-mini">Your local-model response will appear here.</div></div></div></div>
 <div><div class="card card-pad">${cardTitle('Local model connection','Connect to an installed Ollama model','OFFLINE')}
 <div id="ollama-status"><div class="tiny-note">Checking local Ollama service…</div></div>
 ${field('Choose installed model',`<select class="select" id="ollama-choice"><option value="">Checking…</option></select>`)}
 <p class="tiny-note">An installed Ollama model and its initial download require a separate setup. The app never sends an API key or dataset to a third-party cloud service.</p>
 <div class="divider"></div>${cardTitle('Suggested local use cases','')}
 ${['Explain code and Python libraries','Interpret tables and chart trends','Draft analysis workflows','Ask about uploaded documents with RAG','Learn prompts and generative AI concepts'].map(s=>`<div class="signal"><span class="bullet">✓</span>${s}</div>`).join('')}</div></div></div>`;
 refreshLocalModels();
}
function usePrompt(q){el('genai-prompt').value=q;el('genai-prompt').focus()}
async function refreshLocalModels(){try{PLUS.ollama=await api('ollama/models');const box=el('ollama-status');if(box)box.innerHTML=`<div class="notice ${PLUS.ollama.connected?'success':'warning'}">${PLUS.ollama.connected?'✓ Ollama connected locally. '+PLUS.ollama.models.length+' installed model(s) found.':'Ollama not found. Install Ollama and download a local model, then click Check Ollama.'}</div>`;
 const selectBox=el('ollama-choice');if(selectBox)selectBox.innerHTML=PLUS.ollama.models.length?PLUS.ollama.models.map(n=>option(n,n)).join(''):option('','No local models found');
 const ragSelect=el('rag-model');if(ragSelect)ragSelect.innerHTML=PLUS.ollama.models.length?PLUS.ollama.models.map(n=>option(n,n)).join(''):option('','Install a model first');
 }catch(e){noteError(e)}}
async function sendLocalPrompt(){const question=val('genai-prompt').trim(),model=val('ollama-choice');if(!question||!model)return plusAlert('Enter a question and choose an installed local model');
 const btn=el('genai-send');btn.disabled=true;btn.textContent='Generating…';
 try{const r=await api('ollama/chat','POST',{prompt:question,model,use_data:!!el('genai-context')?.checked});el('genai-output').innerHTML=`<div class="section-eyebrow">MODEL RESPONSE</div><div class="chat-output">${esc(r.answer)}</div><p class="tiny-note">Generated by a locally installed model. Verify calculations against the actual dataset.</p>`;}
 catch(e){noteError(e)}finally{btn.disabled=false;btn.textContent='✳ Generate With Local AI';}
}
function viewKnowledge(){
 root().innerHTML=title('Document RAG','Upload your own documents, retrieve relevant passages using TF-IDF, and optionally generate cited answers with a local Ollama model.',`<span class="tag">PRIVATE DOCUMENT LIBRARY</span>`)+
 `<div class="grid grid-main"><div class="card card-pad">${cardTitle('Ask your documents','Grounded search runs without any LLM')}
 ${field('Question',`<textarea id="rag-question" class="textarea" rows="4" placeholder="What does this document explain about data preprocessing?"></textarea>`)}
 <div class="fields cols-2">${field('Response mode',`<select id="rag-mode" class="select"><option value="retrieve">Show matching passages (no model needed)</option><option value="generate">Answer with local Ollama</option></select>`)}${field('Local model (optional)',`<select id="rag-model" class="select"><option value="">No model found</option></select>`)}</div>
 <div class="form-actions"><button class="button primary" id="rag-ask" onclick="askDocuments()">⌕ Search / Answer</button><button class="button ghost" onclick="show('genai')">✳ Local AI Chat</button></div>
 <div class="section-gap" id="rag-answer"><div class="empty-mini">Upload a document, type a question, and press Search / Answer.</div></div></div>
 <div class="card card-pad">${cardTitle('Your knowledge library','Text is indexed and stays on this computer')}
 <div class="dropzone" style="padding:25px;cursor:pointer" onclick="document.getElementById('rag-upload').click()"><div class="drop-icon">↥</div><h3>Add reference documents</h3><p>PDF · Word · TXT · MD · CSV · JSON · PY</p><button class="button primary sm" onclick="event.stopPropagation();document.getElementById('rag-upload').click()">＋ Choose Documents</button></div>
 <input type="file" id="rag-upload" multiple accept=".pdf,.docx,.txt,.md,.csv,.json,.py" hidden onchange="uploadKnowledge(this.files)">
 <div id="rag-docs" class="section-gap"><div class="empty-mini">Reading document library…</div></div>
 <div class="notice section-gap">RAG uses real TF-IDF similarity and quotes source passages. For scanned/image-only PDFs, text extraction requires OCR (not implemented). Retrieval alone does not invent a generated answer.</div></div></div>`;
 loadKnowledge();refreshLocalModels();
}
async function loadKnowledge(){try{PLUS.documents=(await api('knowledge')).documents;const t=el('rag-docs');if(!t)return;
 t.innerHTML=PLUS.documents.map(d=>`<div class="model-list-row"><div><b>${esc(d.name)}</b><div class="tiny-note">${d.chunks} chunks · ${fmt(d.characters)} characters · ${esc(d.created)}</div></div><button class="button sm destructive" onclick="removeKnowledge('${d.id}')">Remove</button></div>`).join('')||'<div class="empty-mini">No documents yet. Upload one to begin.</div>';
 }catch(e){noteError(e)}}
async function uploadKnowledge(files){if(!files?.length)return;const fd=new FormData();[...files].forEach(f=>fd.append('files',f));try{const r=await api('knowledge/import','POST',fd);await loadKnowledge();toast(`${r.imported.length} document(s) indexed locally`);}catch(e){noteError(e)}if(el('rag-upload'))el('rag-upload').value='';}
async function removeKnowledge(id){if(!confirm('Remove this document from the knowledge library?'))return;try{await api('knowledge/'+id,'DELETE');await loadKnowledge();toast('Document removed');}catch(e){noteError(e)}}
async function askDocuments(){const question=val('rag-question').trim();if(!question)return plusAlert('Enter a document question');const btn=el('rag-ask');btn.disabled=true;btn.textContent='Searching…';
 try{const r=await api('knowledge/ask','POST',{question,mode:val('rag-mode'),model:val('rag-model')||null});
 el('rag-answer').innerHTML=`<div class="section-eyebrow">${r.mode==='retrieval_only'?'RETRIEVED PASSAGES':'GROUNDED LOCAL MODEL RESPONSE'}</div><div class="chat-output">${esc(r.answer)}</div><h3 style="font-size:13px;margin:18px 0">Supporting document passages</h3>${r.passages.map(p=>`<div class="doc-result"><b>${esc(p.document)} · chunk ${p.chunk}</b><small> · similarity ${(p.score*100).toFixed(0)}%</small><div style="margin-top:8px">${esc(p.text.slice(0,650))}</div></div>`).join('')||'<p class="tiny-note">No supporting excerpts found.</p>'}`;
 }catch(e){noteError(e)}finally{btn.disabled=false;btn.textContent='⌕ Search / Answer';}
}
const LESSONS=[
 {icon:'▤',name:'Understand Your Data',level:'Beginner',desc:'Columns, records, types, and basic data structure.',concept:'Every row is an observation and every column describes a field. Before analysis, inspect the types, sample rows, and how much information is missing.',demo:'Import a dataset, examine the first rows in Data Workspace, then identify a numeric column.',view:'data',question:'Which is normally a numeric field?',options:['Customer name','Age in years','Country name'],correct:1,why:'Age in years is a quantity that supports numeric summary statistics.'},
 {icon:'✦',name:'Clean Data Correctly',level:'Beginner',desc:'Nulls, duplicate rows, type conversion, and safe undo.',concept:'Cleaning should be purposeful. Duplicate records, invalid numeric fields and missing values affect findings. Never fill missing values without considering why they are missing.',demo:'Try removing duplicate records, then Undo. Open Automatic EDA to see whether missing cells remain.',view:'clean',question:'When is it safe to drop every row with a missing value?',options:['Always','Only when the loss and missingness are justified','Only when the table is large'],correct:1,why:'Removing all missing rows can bias results and waste information.'},
 {icon:'▥',name:'Explore With EDA',level:'Beginner',desc:'Distributions, summary statistics and correlations.',concept:'Exploratory Data Analysis checks what the dataset looks like before model training. Inspect distributions, extreme values, counts, categorical proportions, and correlations.',demo:'Use the Analysis Workbench and click Auto Analysis. Expand one exact-value table.',view:'analyst',question:'Does a high correlation prove one variable causes another?',options:['Yes','No','Only if there are 1,000 rows'],correct:1,why:'Correlations alone do not rule out confounding or reverse causality.'},
 {icon:'∑',name:'Understand Statistics',level:'Intermediate',desc:'Testing assumptions, p-values, and interpretation.',concept:'A statistical test gives evidence conditional on assumptions and a null hypothesis. P-values are not the probability that the null hypothesis is true.',demo:'Open Statistics Lab and run Pearson correlation on two numeric fields.',view:'stats',question:'What does a small p-value establish by itself?',options:['Causality','A very large effect','Evidence against a specified null under assumptions'],correct:2,why:'P-values require assumptions and do not establish an effect size or causality.'},
 {icon:'◉',name:'Train a Predictive Model',level:'Intermediate',desc:'Target variables, train/test split, and leakage.',concept:'Classification predicts categories and is evaluated with accuracy, recall, precision and F1. Regression predicts quantities, typically evaluated with R², MAE and RMSE. Use untouched test data and check for leakage.',demo:'Build a Random Forest classifier on a labeled dataset. Read the holdout accuracy and manually test it in the left panel.',view:'ml',question:'For a regression model, which is a valid evaluation metric?',options:['Classification accuracy','MAE','Confusion matrix labels'],correct:1,why:'Mean absolute error measures regression prediction error.'},
 {icon:'✳',name:'Generative AI Basics',level:'Beginner',desc:'Prompts, language models and factual verification.',concept:'A language model predicts useful next tokens rather than looking up guaranteed facts. A clear prompt states the goal, allowed context, output format, and uncertainties.',demo:'Try an explanatory prompt in Local Generative AI. Check the answer against a trusted reference.',view:'genai',question:'What should you do with a model-generated numerical claim?',options:['Trust it immediately','Check it against the data or calculation','Treat it as guaranteed'],correct:1,why:'LLM answers can be plausible but incorrect; verification is essential.'},
 {icon:'▣',name:'Build a RAG Workflow',level:'Intermediate',desc:'Chunking, retrieval, context and grounded answers.',concept:'Retrieval-augmented generation splits source documents into chunks, retrieves passages related to a question, then passes those passages to a model. Retrieval quality and citations matter.',demo:'Upload a text or PDF document in Document RAG. Search it without a model, then optionally use Ollama.',view:'knowledge',question:'What does the retrieval step do in RAG?',options:['Finds relevant source passages','Always trains an LLM','Changes the uploaded document'],correct:0,why:'Retrieval identifies passages likely to help answer the question.'},
 {icon:'⌘',name:'Query Data Using SQL',level:'Intermediate',desc:'Filtering, selecting, grouping and sorting.',concept:'SQL can summarize relational data with SELECT, WHERE, GROUP BY, aggregates, and ORDER BY. This Studio runs read-only queries against your local tables.',demo:'Run SELECT COUNT(*) AS n FROM data; in SQL Studio.',view:'sql',question:'Which SQL statement summarizes rows by a category?',options:['GROUP BY','DELETE TABLE','DROP DATABASE'],correct:0,why:'GROUP BY lets you compute grouped aggregates.'}
];
function viewAcademy(){
 const done=PLUS.done.length;
 root().innerHTML=title('Interactive Academy','Learn data analytics, machine learning, statistics, SQL and generative AI with lessons, quizzes and direct practice.',`<span class="tag cyan">${done} / ${LESSONS.length} LESSONS COMPLETE</span>`)+
 `<div class="studio-hero"><div><div class="eyebrow">LEARN BY DOING</div><h2>Small lessons. Real software tools.</h2><p>Open a lesson, answer an interactive question, and jump directly to the matching workbench to practice what you learned.</p><button class="button" onclick="loadDemo()">◈ Load Practice Dataset</button></div><div style="font-size:52px;opacity:.55">✎</div></div>
 <div class="lesson-catalog">${LESSONS.map((l,i)=>`<button class="lesson-card ${PLUS.done.includes(i)?'done':''}" onclick="openLesson(${i})"><span class="lesson-icon">${l.icon}</span><h3>${esc(l.name)}</h3><p>${esc(l.desc)}</p><span class="tag ${PLUS.done.includes(i)?'cyan':''}">${PLUS.done.includes(i)?'✓ Completed':esc(l.level)}</span></button>`).join('')}</div>
 <div id="academy-lesson" class="section-gap"></div>`;
}
function openLesson(i){PLUS.lesson=i;PLUS.answer=null;const l=LESSONS[i],target=el('academy-lesson');if(!target)return;
 target.innerHTML=`<div class="lesson-content"><div class="academy-top"><div><div class="section-eyebrow">LESSON ${i+1} / ${LESSONS.length}</div><h2>${esc(l.name)}</h2></div><button class="button ghost sm" onclick="document.getElementById('academy-lesson').innerHTML=''">Close</button></div>
 <div class="notice">${esc(l.concept)}</div><h3 style="margin:22px 0 8px;font-size:14px">Practice challenge</h3><p class="page-lead">${esc(l.demo)}</p><button class="button ghost" onclick="practiceLesson()">▶ Open Practice Tool</button>
 <div class="divider"></div><h3 style="font-size:15px">Knowledge check</h3><p class="page-lead">${esc(l.question)}</p><div class="lesson-options">${l.options.map((x,j)=>`<button class="quiz-opt" data-answer="${j}" onclick="chooseLessonAnswer(${j})">${String.fromCharCode(65+j)}. ${esc(x)}</button>`).join('')}</div>
 <button class="button primary" onclick="checkLessonAnswer()">Check Answer</button><div id="lesson-feedback" class="section-gap"></div></div>`;
 target.scrollIntoView({behavior:'smooth',block:'start'});
}
function chooseLessonAnswer(i){PLUS.answer=i;document.querySelectorAll('.quiz-opt').forEach(btn=>btn.classList.toggle('selected',+btn.dataset.answer===i));}
function checkLessonAnswer(){if(PLUS.answer==null)return plusAlert('Choose an answer first');const lesson=LESSONS[PLUS.lesson];const good=PLUS.answer===lesson.correct;
 const target=el('lesson-feedback');target.innerHTML=`<div class="notice ${good?'success':'warning'}">${good?'✓ Correct! Lesson marked complete.':'Not quite. Try again.'} ${esc(lesson.why)}</div>`;
 if(good&&!PLUS.done.includes(PLUS.lesson)){PLUS.done.push(PLUS.lesson);localStorage.setItem('insightforge_lessons',JSON.stringify(PLUS.done));}
}
async function practiceLesson(){const view=LESSONS[PLUS.lesson].view;if(!hasData()&&['data','clean','analyst','stats','ml','sql'].includes(view))await loadDemo();show(view);}
function viewSettings(){
 root().innerHTML=title('Settings & Storage','Review your workspace location, local-only processing mode, storage, and data protection tools.')+
 `<div class="grid grid-main"><div class="card card-pad"><div class="section-eyebrow">STORAGE AND BACKUP</div>${cardTitle('Local workspace location','Data, models, and knowledge documents are stored in one directory')}
 <div id="settings-path" class="storage-line">Checking local storage…</div><div class="form-actions"><button class="button primary" onclick="download('project')">⇩ Export Workspace ZIP</button><button class="button ghost" onclick="show('export')">Export Individual Files</button></div>
 <div class="divider"></div>${cardTitle('D: drive installation','Low C: space? Keep everything on D:')}
 <div class="notice success">Windows installation uses <b>D:\\InsightForge Analytics Studio</b> by default when installed using INSTALL_TO_D_DRIVE.bat. Python libraries, datasets, ML models, knowledge documents, and temporary files will be directed to D:.</div>
 <p class="tiny-note section-gap">Use the installer included in the ZIP. It copies the app to D: and can copy any earlier workspace without deleting your old files. Deletion from C: is intentionally not automatic.</p></div>
 <div class="card card-pad">${cardTitle('Engine and privacy','No remote analytics server and no built-in cloud account','LOCAL')}
 <div class="notice success">✓ FastAPI engine listens only on 127.0.0.1. Dataset operations, charts, statistics and machine-learning training run locally.</div>
 <div class="divider"></div>${cardTitle('Model and AI support','')}
 ${['Scikit-learn local model training + manual prediction','Ollama local generative chat (requires installed model)','TF-IDF document retrieval without an LLM','Undo and backups for editable dataset operations'].map(s=>`<div class="signal"><span class="bullet">✓</span>${s}</div>`).join('')}
 <p class="tiny-note section-gap">If you intentionally import public URLs, the app downloads those files over the internet. No arbitrary Python code from uploaded files is executed.</p></div></div>`;
 api('health').then(x=>{if(el('settings-path'))el('settings-path').textContent=x.workspace}).catch(e=>noteError(e));
}
window.enhanceOverview=enhanceOverview;
window.exportGuidedReport=exportGuidedReport;
window.viewMLV2=viewMLV2;
Object.assign(window,{chooseRecipe,runGuided,runAutoDashboard,modelAlgorithms,syncModelOptions,loadSavedModels,
 selectTrainedModel,trainAdvancedModel,predictManually,resetModelSamples,deleteTrainedModel,
 usePrompt,refreshLocalModels,sendLocalPrompt,loadKnowledge,uploadKnowledge,removeKnowledge,askDocuments,
 openLesson,chooseLessonAnswer,checkLessonAnswer,practiceLesson});
