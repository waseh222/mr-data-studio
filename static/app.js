/* InsightForge Studio — local-first client, no external services or CDN. */
const A = {
  view:'overview', state:null, tablePage:1, pageSize:25, search:'', sort:'', descending:false,
  chartSpec:{kind:'histogram',x:'',y:'',color:'',agg:'count',bins:30,title:''},
  cleaningOp:'drop_duplicates', lastChart:null, latestEDA:null, mlResult:null,
  savedCharts:JSON.parse(localStorage.getItem('if_charts')||'[]'), busy:false
};
const el=id=>document.getElementById(id);
const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const fmt=v=>typeof v==='number'?v.toLocaleString('en-US',{maximumFractionDigits:3}):v;
const byteSize=n=>n<1024?`${n} B`:n<1024*1024?`${(n/1024).toFixed(1)} KB`:`${(n/1048576).toFixed(1)} MB`;
const val=id=>el(id)?.value||'';
const option=(value,label,sel=false)=>`<option value="${esc(value)}" ${sel?'selected':''}>${esc(label)}</option>`;
const field=(label,control)=>`<div class="field"><label>${label}</label>${control}</div>`;
const input=(id,placeholder='',v='')=>`<input class="input" id="${id}" placeholder="${esc(placeholder)}" value="${esc(v)}">`;
const select=(id,opts,selected='',empty='Select column…')=>`<select class="select" id="${id}">${empty===null?'':option('',empty,selected==='')}${opts.map(c=>option(c,c,c===selected)).join('')}</select>`;
const cols=()=>A.state?.profile?.columns_info?.map(c=>c.name)||[];
const nums=()=>A.state?.profile?.columns_info?.filter(c=>/int|float|double|number/i.test(c.dtype)).map(c=>c.name)||[];
const dataset=()=>A.state?.datasets.find(d=>d.id===A.state.active);
const root=()=>el('view-root');
const hasData=()=>!!A.state?.active;
function toast(message,error=false){const t=document.createElement('div');t.className='toast'+(error?' error':'');t.textContent=(error?'⚠  ':'✓  ')+message;el('toast-area').append(t);setTimeout(()=>t.remove(),4300);}
function noteError(e){toast(e.message||String(e),true);}
async function api(path,method='GET',data){
 const options={method,headers:{}};
 if(data instanceof FormData)options.body=data;
 else if(data!==undefined){options.headers['Content-Type']='application/json';options.body=JSON.stringify(data);}
 let res;
 try{res=await fetch('/api/'+path,options);}catch(e){throw new Error('Cannot reach the local analytics engine. Check that the app is running.');}
 const text=await res.text();let obj;
 try{obj=JSON.parse(text);}catch{obj={detail:text.slice(0,400)};}
 if(!res.ok)throw new Error(typeof obj.detail==='string'?obj.detail:JSON.stringify(obj.detail||`HTTP ${res.status}`));
 return obj;
}
async function refresh(render=true){A.state=await api('state');drawSidebar();updateToolbar();if(render)show(A.view,false);}
function updateToolbar(){el('undo-btn').disabled=!(A.state?.undo);el('redo-btn').disabled=!(A.state?.redo);}
function drawSidebar(){
 const l=el('dataset-list');l.innerHTML=A.state.datasets.length?A.state.datasets.map(d=>`<button class="dataset-button ${A.state.active===d.id?'selected':''}" data-id="${d.id}" title="${esc(d.name)}"><span class="dataset-icon">▤</span><span>${esc(d.name)}</span></button>`).join(''):'<p class="muted small">Import a file to get started.</p>';
 l.querySelectorAll('button').forEach(b=>b.onclick=()=>chooseDataset(b.dataset.id));
 document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===A.view));
}
async function chooseDataset(id){try{await api('select/'+id,'POST');A.latestEDA=null;A.lastChart=null;A.mlResult=null;await refresh();toast('Active dataset changed');}catch(e){noteError(e);}}
async function action(name){try{await api(name,'POST');await refresh();toast(`${name[0].toUpperCase()+name.slice(1)} complete`);}catch(e){noteError(e);}}
async function importFiles(files){
 if(!files||!files.length)return;
 const fd=new FormData();Array.from(files).forEach(f=>fd.append('files',f));toast(`Reading ${files.length} file(s)…`);
 try{const r=await api('import','POST',fd);A.latestEDA=null;A.lastChart=null;A.mlResult=null;await refresh();show('overview');toast(`Imported ${r.imported.length} dataset(s).`);}catch(e){noteError(e);}
 el('file-input').value='';
}
async function loadDemo(){try{const r=await api('demo','POST');await refresh();show('overview');toast('Synthetic retail demo dataset ready.');}catch(e){noteError(e);}}
function show(view,scroll=true){
 A.view=view;drawSidebar();
 const names={overview:'Overview',data:'Data Workspace',import:'Data Sources',clean:'Cleaning Studio',transform:'Transform & Join',eda:'Automatic EDA',analyst:'Analysis Workbench',charts:'Visual Lab',stats:'Statistics Lab',ml:'Model Builder',genai:'Generative AI',knowledge:'Document RAG',academy:'Interactive Academy',sql:'SQL Studio',export:'Export Center',settings:'Settings & Storage'};
 el('crumb-name').textContent=names[view]||view;
 if(!['import','ml','genai','knowledge','academy','settings'].includes(view)&&!hasData()){root().innerHTML=emptyState();return;}
 const renderer={overview:viewOverview,data:viewData,import:viewImport,clean:viewClean,transform:viewTransform,eda:viewEDA,charts:viewCharts,stats:viewStats,ml:viewML,analyst:viewAnalyst,genai:viewGenAI,knowledge:viewKnowledge,academy:viewAcademy,settings:viewSettings,sql:viewSQL,export:viewExport}[view];
 if(renderer)renderer();
 if(view==='overview'&&window.enhanceOverview)window.enhanceOverview();
 if(scroll)el('page-scroll').scrollTo({top:0,behavior:'smooth'});
 el('sidebar').classList.remove('open');
}
function title(head,description,actions=''){return `<div class="page-head"><div><div class="eyebrow">INSIGHTFORGE / ${esc(head)}</div><h1>${esc(head)}</h1><p class="page-lead">${description}</p></div><div class="head-actions">${actions}</div></div>`;}
function cardTitle(t,sub='',chip=''){return `<div class="card-head"><div><h2>${t}</h2><p>${sub}</p></div>${chip?`<span class="head-chip">${chip}</span>`:''}</div>`;}
function emptyState(){return `<div class="no-data"><div class="big-icon">◈</div><div class="eyebrow">YOUR ANALYTICS JOURNEY STARTS HERE</div><h2>Turn raw data into clear decisions.</h2><p>Import CSV, Excel, JSON, SQLite or Parquet data, or load the included synthetic demonstration. Your files stay on this PC.</p><button class="button primary" onclick="document.getElementById('file-input').click()">＋ Import Your First Dataset</button> <button class="button ghost" onclick="loadDemo()">◈ Explore Demo Data</button></div>`;}
function statCard(label,value,foot,icon){return `<div class="card stat-card"><div class="stat-label">${label}</div><div class="stat-icon">${icon}</div><div class="stat-value">${value}</div><div class="stat-foot">${foot}</div></div>`;}
function formatTable(rows,head=null){if(!rows||!rows.length)return '<div class="empty-mini">No records available.</div>';const keys=head||Object.keys(rows[0]);return `<div class="table-scroll"><table><thead><tr>${keys.map(k=>`<th>${esc(k.replace(/_/g,' '))}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${keys.map(k=>`<td title="${esc(r[k])}">${esc(r[k]==null?'—':typeof r[k]==='number'?fmt(r[k]):r[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;}
function overviewActivity(){return (A.state.activities||[]).length?A.state.activities.slice(0,6).map(a=>`<div class="activity-item"><strong>${esc(a.message)}</strong><time>${esc(a.when)}</time></div>`).join(''):'<div class="empty-mini">Activity will appear here.</div>';}
function viewOverview(){
 const p=A.state.profile,d=dataset();
 root().innerHTML=title('Analytics Overview',`The command center for <strong>${esc(d?.name)}</strong>. Explore data quality, field types, trends, and latest activity.`, `<button class="button ghost sm" onclick="show('eda')">◎ Run Auto EDA</button><button class="button primary sm" onclick="show('charts')">▥ Create Chart</button>`)+
 `<div class="grid grid-4">${statCard('TOTAL RECORDS',fmt(p.rows),'Across this dataset','▤')}${statCard('DATA FIELDS',fmt(p.columns),`${p.numeric} numeric · ${p.categorical} categorical`,'▦')}${statCard('MISSING VALUES',`${p.missing_pct}%`,`${fmt(p.missing)} empty cells`,'◷')}${statCard('DUPLICATE ROWS',fmt(p.duplicates),'Exact row matches','♧')}</div>`+
 `<div class="grid grid-main section-gap"><div class="card card-pad">${cardTitle('Missing values by field','Top 12 fields with incomplete records','LIVE PROFILE')}<div class="plot" id="overview-missing"></div></div><div class="card card-pad">${cardTitle('Dataset health','Simple completeness and duplicate heuristic','DATA QUALITY')}<div class="quality-number">${p.quality}<span class="muted" style="font-size:17px"> / 100</span></div><div class="quality-track"><div class="quality-fill" style="width:${p.quality}%"></div></div><p class="quality-caption">The score is a quick screening indicator, not a guarantee of data validity or fitness for analysis.</p><div class="divider"></div><div class="grid grid-2" style="gap:12px">${statInline('NUMERIC',p.numeric)}${statInline('CATEGORICAL',p.categorical)}${statInline('DATE FIELDS',p.datetime)}${statInline('MEMORY',byteSize(p.memory_bytes))}</div></div></div>`+
 `<div class="grid grid-main section-gap"><div class="card card-pad">${cardTitle('Column completeness','Find fields that need attention')}
 <div class="progress-list">${p.columns_info.slice().sort((a,b)=>b.missing-a.missing).slice(0,8).map(c=>`<div class="progress-row"><span title="${esc(c.name)}">${esc(c.name.slice(0,19))}</span><div class="bar"><span style="width:${100-c.missing_pct}%"></span></div><b>${(100-c.missing_pct).toFixed(0)}%</b></div>`).join('')}</div></div>
 <div class="card card-pad">${cardTitle('Recent activity','Workspace action history')}${overviewActivity()}</div></div>`;
 const items=p.columns_info.slice().sort((a,b)=>b.missing-a.missing).slice(0,12);
 const labels=items.map(x=>x.name).reverse();const values=items.map(x=>x.missing).reverse();
 plot('overview-missing',[{type:'bar',orientation:'h',x:values,y:labels,marker:{color:'#8c83ff',line:{width:0}},hovertemplate:'%{y}: %{x} missing<extra></extra>'}],{
 margin:{l:135,r:24,t:12,b:42},xaxis:{title:'Missing cells'},yaxis:{automargin:true}
 });
}
function statInline(t,v){return `<div><div class="muted tiny">${t}</div><div style="font-weight:750;font-size:19px;margin-top:4px">${v}</div></div>`;}
function plot(id,data,layout={}){
 const container=el(id);if(!container||!window.Plotly)return;
 Plotly.react(container,data,{paper_bgcolor:'rgba(0,0,0,0)',plot_bgcolor:'rgba(0,0,0,0)',font:{color:getComputedStyle(document.documentElement).getPropertyValue('--muted').trim(),family:'Segoe UI, sans-serif',size:11},margin:{l:42,r:24,t:25,b:45},...layout},
 {responsive:true,displaylogo:false,modeBarButtonsToRemove:['sendDataToCloud','lasso2d','select2d']});
}
function viewData(){
 root().innerHTML=title('Data Workspace','Inspect, search, sort, and edit records directly. Double-click a cell to change its value.',`<button class="button ghost sm" onclick="openFormula()">＋ Calculated Column</button><button class="button ghost sm" onclick="show('clean')">✦ Clean Data</button>`)+
 `<div class="card card-pad"><div class="card-head"><div><h2>Live Data Grid</h2><p>${esc(dataset()?.name)} · double-click to edit</p></div><span class="tag cyan">EDITABLE</span></div>
 <div class="fields cols-3" style="margin-bottom:16px">${field('Search all columns',input('table-search','Type to filter rows…',A.search))}${field('Rows per page',`<select id="table-size" class="select">${[10,25,50,100,200].map(n=>option(n,n,n===A.pageSize)).join('')}</select>`)}${field('Quick actions',`<div class="form-actions" style="margin:0"><button class="button ghost sm" onclick="reloadTable()">↻ Refresh</button><button class="button danger sm" onclick="confirmReset()">⟲ Reset to original</button></div>`)}</div><div id="data-grid"><div class="loading"><div class="loading-ring"></div></div></div></div>`;
 el('table-search').oninput=debounce(()=>{A.search=val('table-search');A.tablePage=1;reloadTable();},350);
 el('table-size').onchange=()=>{A.pageSize=+val('table-size');A.tablePage=1;reloadTable();};
 reloadTable();
}
function debounce(fn,ms=250){let h;return (...args)=>{clearTimeout(h);h=setTimeout(()=>fn(...args),ms);};}
async function reloadTable(){
 if(!hasData())return;
 try{
  const qs=new URLSearchParams({page:A.tablePage,page_size:A.pageSize,search:A.search,sort:A.sort,descending:A.descending});
  const t=await api('table?'+qs);
  let grid=el('data-grid');if(!grid)return;
  const headers=t.columns.map((c,i)=>`<th style="cursor:pointer" data-sort="${esc(c)}">${esc(c)} <span style="opacity:.7">${A.sort===c?(A.descending?'▼':'▲'):'↕'}</span><span class="col-type">${esc(t.dtypes[i])}</span></th>`).join('');
  let rows=t.rows.map(r=>`<tr><td style="color:var(--muted);font-size:10px">${r._row_id+1}</td>${t.columns.map(c=>`<td class="editable-cell" data-row="${r._row_id}" data-col="${esc(c)}" title="Double-click to edit">${esc(r[c]==null?'':String(r[c]))}</td>`).join('')}</tr>`).join('');
  grid.innerHTML=`<div class="table-scroll"><table><thead><tr><th>#</th>${headers}</tr></thead><tbody>${rows||`<tr><td colspan="${t.columns.length+1}" class="muted">No matching rows</td></tr>`}</tbody></table></div><div class="table-meta"><span>Displaying ${fmt(t.rows.length)} of ${fmt(t.total)} matching records</span><div class="pagination"><button class="button sm ghost" id="page-prev" ${t.page<=1?'disabled':''}>← Previous</button><span>Page ${t.page} / ${Math.max(1,Math.ceil(t.total/t.page_size))}</span><button class="button sm ghost" id="page-next" ${t.page*t.page_size>=t.total?'disabled':''}>Next →</button></div></div>`;
  grid.querySelectorAll('th[data-sort]').forEach(h=>h.onclick=()=>{if(A.sort===h.dataset.sort)A.descending=!A.descending;else{A.sort=h.dataset.sort;A.descending=false;}A.tablePage=1;reloadTable();});
  grid.querySelectorAll('.editable-cell').forEach(td=>td.ondblclick=()=>editCell(td));
  el('page-prev').onclick=()=>{A.tablePage--;reloadTable()};el('page-next').onclick=()=>{A.tablePage++;reloadTable()};
 }catch(e){noteError(e);}
}
function editCell(td){if(td.querySelector('input'))return;const original=td.textContent;const inputEl=document.createElement('input');inputEl.className='cell-input';inputEl.value=original;td.textContent='';td.appendChild(inputEl);inputEl.focus();inputEl.select();let done=false;
 const finish=async save=>{if(done)return;done=true;const next=inputEl.value;td.textContent=original;if(!save||next===original)return;
  try{await api('cell','PATCH',{row:+td.dataset.row,column:td.dataset.col,value:next});await refresh(false);await reloadTable();toast('Cell updated');}catch(e){noteError(e);}}
 inputEl.onkeydown=e=>{if(e.key==='Enter')finish(true);if(e.key==='Escape')finish(false);};inputEl.onblur=()=>finish(true);
}
function confirmReset(){modal('Restore original dataset','This replaces your current working table with the imported original. You can still use Undo.',()=>action('reset'),'Restore');}
function viewImport(){root().innerHTML=title('Data Sources','Connect data from common local formats, a direct public URL, pasted text, or a ZIP collection.')+
 `<div class="grid grid-main"><div class="card card-pad">${cardTitle('Import local datasets','Drag & drop files or browse this computer','MULTI-FORMAT')}
 <div class="dropzone" id="dropzone" tabindex="0"><div class="drop-icon">↥</div><h2>Drop your data files here</h2><p>or click to browse your local files</p><span class="button primary sm">Choose Files</span><p class="support-types">CSV · TSV · Excel · JSON · JSONL · Parquet · SQLite · ZIP</p></div>
 <div class="notice section-gap">Maximum 65 MB per file, 200,000 rows, 400 fields and 30 datasets per local workspace. ZIP can contain up to 10 supported datasets.</div></div>
 <div class="card card-pad">${cardTitle('Import from a URL','Load a public CSV, JSON, XLSX, or Parquet link')}
 ${field('Public HTTPS/HTTP file URL',input('import-url','https://example.org/data.csv'))}
 <div class="form-actions"><button class="button primary" onclick="importURL()">↧ Fetch Dataset</button></div><div class="divider"></div>
 ${cardTitle('Quick start','Explore a fully synthetic example')}<p class="page-lead">Get 700+ sample records with dates, regions, revenue, profit, missing values, and duplicate records.</p>
 <button class="button cyan" onclick="loadDemo()">◈ Create Demo Dataset</button></div></div>`+
 `<div class="grid grid-2 section-gap"><div class="card card-pad">${cardTitle('Paste spreadsheet / CSV data','Paste copied rows, CSV, TSV, JSON, or JSONL')}
 <div class="fields cols-2">${field('Dataset name',input('paste-name','E.g. Customer Data','Pasted Data'))}${field('Format',`<select class="select" id="paste-format"><option value="csv">CSV</option><option value="tsv">TSV</option><option value="json">JSON</option><option value="jsonl">JSON Lines</option></select>`)}</div>
 ${field('Data text',`<textarea class="textarea code" id="paste-text" placeholder="name,amount,region&#10;Alice,150,North&#10;Bob,250,South"></textarea>`)}<div class="form-actions"><button class="button primary" onclick="importPaste()">＋ Import Pasted Data</button></div></div>
 <div class="card card-pad">${cardTitle('Connected workspace','Loaded datasets on this computer','PRIVATE')}
 ${(A.state.datasets||[]).map(d=>`<div class="export-item"><div class="export-left"><div class="export-icon">▤</div><div><div class="export-name">${esc(d.name)}</div><div class="export-description">${esc(d.origin)} · ${esc(d.created)}</div></div></div><button class="button danger mini" onclick="confirmDelete('${d.id}')">Delete</button></div>`).join('')||'<div class="empty-mini">No datasets yet.</div>'}
 </div></div>`;
 const dz=el('dropzone');dz.onclick=()=>el('file-input').click();dz.ondragover=e=>{e.preventDefault();dz.classList.add('dragover')};dz.ondragleave=()=>dz.classList.remove('dragover');dz.ondrop=e=>{e.preventDefault();dz.classList.remove('dragover');importFiles(e.dataTransfer.files);};
}
async function importPaste(){try{const r=await api('import-text','POST',{name:val('paste-name'),format:val('paste-format'),text:val('paste-text')});await refresh();show('overview');toast('Pasted data imported.');}catch(e){noteError(e)}}
async function importURL(){if(!val('import-url'))return toast('Enter a public URL',true);try{toast('Fetching public dataset…');await api('import-url','POST',{name:'Remote Data',url:val('import-url')});await refresh();show('overview');toast('Remote dataset loaded');}catch(e){noteError(e)}}
function confirmDelete(id){modal('Delete local dataset','This permanently removes the dataset from this local workspace. Export a backup first if needed.',async()=>{await api('datasets/'+id,'DELETE');await refresh();show('import');toast('Dataset deleted');},'Delete dataset');}
function modal(heading,message,callback,ok='Continue'){
 const parent=el('modal-root');parent.innerHTML=`<div class="modal-card"><h2>${esc(heading)}</h2><p class="page-lead">${esc(message)}</p><div class="modal-actions"><button class="button ghost" id="modal-cancel">Cancel</button><button class="button primary" id="modal-yes">${esc(ok)}</button></div></div>`;
 parent.classList.remove('hidden');el('modal-cancel').onclick=closeModal;el('modal-yes').onclick=async()=>{closeModal();try{await callback();}catch(e){noteError(e)}};
 parent.onclick=e=>{if(e.target===parent)closeModal()};
}
function closeModal(){el('modal-root').classList.add('hidden')}
const OPS=[
 ['drop_duplicates','Remove duplicate rows','Deduplicate records (optionally by selected columns)'],
 ['drop_missing_rows','Remove missing rows','Discard records with null values'],
 ['drop_missing_columns','Remove empty columns','Drop columns with all or any missing entries'],
 ['fill_missing','Fill missing values','Mean, median, mode, constant, forward or backward fill'],
 ['text_transform','Standardize text','Trim spaces, lowercase, uppercase, title case'],
 ['convert_type','Convert column types','Numeric, datetime, text or category'],
 ['outlier_iqr','Handle outliers','Cap or remove IQR-based numeric outliers'],
 ['scale','Scale numeric fields','Z-score standardization or min/max scaling'],
 ['rename','Rename a column','Update a column name'],
 ['drop_columns','Remove columns','Permanently remove selected fields (Undo supported)'],
 ['filter','Filter rows','Keep only rows matching your conditions']
];
function viewClean(){
 root().innerHTML=title('Cleaning Studio','An auditable no-code transformation workbench. Every change is reversible using Undo.',`<button class="button ghost sm" onclick="action('undo')">↶ Undo</button><button class="button ghost sm" onclick="action('redo')">↷ Redo</button>`)+
 `<div class="grid grid-narrow"><div class="card card-pad">${cardTitle('Configure transformation','Choose an operation, its columns, and options')}
 <div class="fields cols-2"><div class="field"><label>Transformation</label><div class="op-list">${OPS.map(([id,label,sub])=>`<button class="op-item ${id===A.cleaningOp?'active':''}" data-op="${id}"><strong>${esc(label)}</strong><small>${esc(sub)}</small></button>`).join('')}</div></div>
 <div id="clean-options"></div></div><div class="form-actions"><button class="button primary" onclick="runClean()">✦ Apply Transformation</button><button class="button ghost" onclick="openFormula()">＋ Calculated Column</button></div></div>
 <div class="card card-pad">${cardTitle('Current dataset quality','Before/after updates are immediate','LIVE')}
 <div class="quality-number">${A.state.profile.quality} <span class="muted small">/ 100</span></div><div class="quality-track"><div class="quality-fill" style="width:${A.state.profile.quality}%"></div></div>
 <div class="divider"></div>${['rows','columns','missing','duplicates'].map(k=>`<div class="export-item"><span class="muted small">${k.toUpperCase()}</span><b>${fmt(A.state.profile[k])}</b></div>`).join('')}
 <div class="divider"></div><div class="notice">Original imports are preserved. Undo/Redo keeps the most recent 10 edits during this app session; restart clears undo history.</div>
 <div class="form-actions"><button class="button danger sm" onclick="confirmReset()">⟲ Restore imported original</button></div></div></div>`;
 document.querySelectorAll('.op-item').forEach(b=>b.onclick=()=>{A.cleaningOp=b.dataset.op;document.querySelectorAll('.op-item').forEach(c=>c.classList.toggle('active',c===b));cleanOptions();});cleanOptions();
}
function cleanOptions(){
 const op=A.cleaningOp;
 const labels={fill_missing:'Fill method',text_transform:'Text operation',convert_type:'Convert to',outlier_iqr:'Outlier action',scale:'Scaling method',filter:'Comparison',drop_missing_rows:'Drop when',drop_missing_columns:'Drop when'};
 const methods={fill_missing:['median','mean','mode','constant','forward','backward'],text_transform:['strip','lower','upper','title'],convert_type:['numeric','datetime','text','category'],outlier_iqr:['cap','remove'],scale:['zscore','minmax'],filter:['equals','not_equals','contains','gt','gte','lt','lte','is_missing'],drop_missing_rows:['any','all'],drop_missing_columns:['all','any']};
 const required=['fill_missing','text_transform','convert_type','outlier_iqr','scale','filter','drop_missing_rows','rename','drop_columns'];
 el('clean-options').innerHTML=`<div class="field"><label>Select columns ${required.includes(op)?'(required for this operation)':'(optional)'}</label><select id="clean-cols" class="select multi-select" multiple size="8">${cols().map(c=>option(c,c)).join('')}</select><p class="help">Hold Ctrl to select several fields, or Shift for a range.</p></div>
 ${methods[op]?field(labels[op],`<select class="select" id="clean-method">${methods[op].map(m=>option(m,m.replace(/_/g,' '))).join('')}</select>`):''}
 ${op==='fill_missing'||op==='filter'?field('Value (for constant fill or filter)',input('clean-value','Enter a value')):''}
 ${op==='rename'?field('New column name',input('clean-new','E.g. Adjusted_Revenue')):''}`;
}
async function runClean(){
 const columns=Array.from(el('clean-cols')?.selectedOptions||[]).map(x=>x.value);
 const data={operation:A.cleaningOp,columns,value:val('clean-value')||null,method:val('clean-method')||null,new_name:val('clean-new')||null};
 try{const result=await api('clean','POST',data);await refresh();toast(`${A.cleaningOp.replaceAll('_',' ')} applied · ${result.before[0]} → ${result.after[0]} rows`);}catch(e){noteError(e);}
}
function openFormula(){
 let parent=el('modal-root');parent.classList.remove('hidden');parent.innerHTML=`<div class="modal-card"><h2>＋ Add calculated field</h2><p class="page-lead">Compute a new field from existing numeric columns, using a safe formula builder.</p>
 <div class="fields cols-2">${field('New field name',input('calc-name','E.g. Margin'))}${field('Source column A',select('calc-a',nums()))}
 ${field('Operation',`<select class="select" id="calc-op">${['add','subtract','multiply','divide','log1p','sqrt','percent_of_total','cumulative_sum','zscore'].map(x=>option(x,x.replaceAll('_',' '))).join('')}</select>`)}
 ${field('Optional column B',select('calc-b',nums()))}${field('Or numeric constant',`<input class="input" id="calc-constant" type="number" step="any" placeholder="Optional">`)}</div>
 <div class="modal-actions"><button class="button ghost" onclick="closeModal()">Cancel</button><button class="button primary" id="calc-apply">Create Column</button></div></div>`;
 el('calc-apply').onclick=async()=>{try{await api('formula','POST',{name:val('calc-name'),a:val('calc-a'),op:val('calc-op'),b:val('calc-b')||null,constant:val('calc-constant')===''?null:+val('calc-constant')});closeModal();await refresh();toast('Calculated column added');}catch(e){noteError(e)}};
}
function viewEDA(){
 const p=A.state.profile;
 root().innerHTML=title('Automatic EDA','A one-click exploratory data analysis report: distributions, field quality, descriptive statistics, and correlations.',`<button class="button ghost sm" onclick="download('report')">⇩ Download EDA Report</button><button class="button primary sm" onclick="runEDA()">◎ Run / Refresh EDA</button>`)+
 `<div class="grid grid-4">${statCard('DATA QUALITY',p.quality+'/100','Heuristic completeness','◈')}${statCard('VALID CELLS',fmt(p.rows*p.columns-p.missing),'Non-missing entries','✓')}${statCard('NUMERIC FIELDS',p.numeric,'Eligible for numeric stats','∑')}${statCard('UNIQUE ROWS',fmt(p.rows-p.duplicates),'After exact deduplication','▤')}</div>
 <div id="eda-container" class="section-gap"><div class="loading"><div class="loading-ring"></div><p>Profiling your data locally…</p></div></div>`;
 runEDA();
}
async function runEDA(){try{
 const r=await api('eda');A.latestEDA=r;const target=el('eda-container');if(!target)return;
 const p=r.profile;
 target.innerHTML=`<div class="grid grid-main"><div class="card card-pad">${cardTitle('Missingness by field','Shows the percentage of missing values for each column')}<div class="plot" id="eda-missing"></div></div>
 <div class="card card-pad">${cardTitle('Automated insights','Rule-based findings from the current dataset','AUTO SUMMARY')}<ul class="insight-list">${r.insights.map(i=>`<li>${esc(i)}</li>`).join('')}</ul></div></div>
 <div class="grid grid-main section-gap"><div class="card card-pad">${cardTitle('Correlation heatmap','Pearson correlation coefficients for numeric fields')}<div class="plot" id="eda-heatmap"></div></div>
 <div class="card card-pad">${cardTitle('Strongest variable relationships','Top linear correlations; not evidence of causation')}${r.strongest_correlations.length?formatTable(r.strongest_correlations.slice(0,8),['a','b','r']):'<div class="empty-mini">At least two variable numeric fields are needed.</div>'}</div></div>
 <div class="card card-pad section-gap">${cardTitle('Numeric descriptive statistics','Count, central tendency, spread, quartiles, skewness','PROFILE')}${formatTable(r.descriptive,['column','count','mean','median','std','min','p25','p75','max','skew'])}</div>
 <div class="card card-pad section-gap">${cardTitle('Data dictionary','Field names, inferred types, missing values, uniqueness, examples')}${formatTable(p.columns_info.map(c=>({column:c.name,dtype:c.dtype,missing:c.missing,missing_pct:c.missing_pct+'%',unique:c.unique,examples:c.sample.join(' / ')})))}</div>
 <div class="card card-pad section-gap">${cardTitle('Top categories','Most frequent categories for non-numeric fields')}
 <div class="grid grid-3">${r.categorical.slice(0,12).map(c=>`<div class="column-chip"><strong>${esc(c.column)}</strong><div style="margin-top:11px">${c.top_values.map(v=>`<div class="export-item"><span class="muted small">${esc(v.value.slice(0,26))}</span><b class="small">${v.count}</b></div>`).join('')}</div></div>`).join('')||'<span class="muted small">No categorical fields.</span>'}</div></div>`;
 const fields=p.columns_info.slice().sort((a,b)=>b.missing_pct-a.missing_pct).slice(0,22);
 plot('eda-missing',[{type:'bar',x:fields.map(c=>c.name),y:fields.map(c=>c.missing_pct),marker:{color:'#7e78eb'},hovertemplate:'%{x}: %{y}%<extra></extra>'}],{yaxis:{title:'Missing (%)'},xaxis:{tickangle:-35,automargin:true},margin:{l:55,r:10,t:20,b:110}});
 if(r.correlations.columns.length>=2){plot('eda-heatmap',[{type:'heatmap',x:r.correlations.columns,y:r.correlations.columns,z:r.correlations.values,zmin:-1,zmax:1,colorscale:'RdBu',reversescale:true,hovertemplate:'%{x} / %{y}: %{z:.3f}<extra></extra>'}],{margin:{l:105,r:30,t:20,b:110},xaxis:{tickangle:-35,automargin:true},yaxis:{automargin:true}})}
 else el('eda-heatmap').innerHTML='<div class="empty-mini">Select a dataset with at least two numeric fields.</div>';
 }catch(e){noteError(e);const t=el('eda-container');if(t)t.innerHTML=`<div class="notice warning">${esc(e.message)}</div>`;}
}
const CHART_TYPES=[['histogram','Histogram'],['scatter','Scatter Plot'],['line','Line Chart'],['bar','Bar Chart'],['box','Box Plot'],['violin','Violin Plot'],['pie','Pie / Donut'],['area','Area Chart'],['heatmap','Correlation Heatmap'],['count','Count Plot'],['density','Density Histogram'],['scatter_3d','3D Scatter'],['treemap','Treemap']];
function viewCharts(){
 const spec=A.chartSpec;
 root().innerHTML=title('Visual Lab','Build customizable, exportable interactive Plotly charts or PNG charts rendered using Matplotlib and Seaborn.',`<button class="button ghost sm" onclick="saveChart()">☆ Save Preset</button><button class="button primary sm" onclick="makeChart()">▥ Generate Chart</button>`)+
 `<div class="grid grid-narrow"><div><div class="card card-pad">${cardTitle('Chart canvas','Pan, zoom, select and hover for precise exploration','INTERACTIVE')}<div class="plot big" id="chart-canvas"><div class="empty-mini">Configure your chart and press Generate Chart.</div></div>
 <div class="form-actions"><button class="button ghost sm" onclick="download('chart/html')">⇩ Interactive HTML</button><button class="button ghost sm" onclick="download('chart/png')">⇩ PNG · Seaborn / Matplotlib</button><button class="button ghost sm" onclick="saveChart()">☆ Save Chart Preset</button></div></div>
 <div class="card card-pad section-gap">${cardTitle('Saved chart presets','Presets are saved in this browser on this device')}<div id="chart-presets"></div></div></div>
 <div class="card card-pad">${cardTitle('Visualization controls','Choose chart type and data mappings')}
 ${field('Visualization type',`<select class="select" id="chart-kind">${CHART_TYPES.map(c=>option(c[0],c[1],spec.kind===c[0])).join('')}</select>`)}
 <div class="divider"></div>${field('X-axis / Category',select('chart-x',cols(),spec.x))}
 ${field('Y-axis / Numeric measure',select('chart-y',cols(),spec.y))}${field('Color / Group By',select('chart-color',cols(),spec.color,'None'))}
 ${field('Aggregate',`<select class="select" id="chart-agg">${['count','sum','mean','median','min','max'].map(x=>option(x,x,x===spec.agg)).join('')}</select>`)}
 ${field('Histogram bins',`<input class="input" type="number" min="3" max="150" id="chart-bins" value="${spec.bins}">`)}
 ${field('Title',input('chart-title','Custom chart title…',spec.title))}
 <div class="form-actions"><button class="button primary" onclick="makeChart()">◈ Generate</button></div>
 <div class="divider"></div><div class="notice">For responsive interactivity, charts sample up to 30,000 rows. Aggregate charts summarize the sampled data when this threshold is exceeded. PNG is available for common 2D types.</div></div></div>`;
 el('chart-kind').onchange=()=>{const k=val('chart-kind');if(k==='heatmap'){el('chart-x').value='';el('chart-y').value='';}};
 drawChartPresets();
 if(A.lastChart){Plotly.react('chart-canvas',A.lastChart.data,A.lastChart.layout,{responsive:true,displaylogo:false});}
}
function selectedChart(){return {kind:val('chart-kind'),x:val('chart-x')||null,y:val('chart-y')||null,color:val('chart-color')||null,agg:val('chart-agg'),bins:Math.max(3,Math.min(150,Number(val('chart-bins'))||30)),title:val('chart-title')||null};}
async function makeChart(){
 try{const s=selectedChart();A.chartSpec={...s};const fig=await api('chart','POST',s);A.lastChart=fig;
  if(!el('chart-canvas'))return;
  Plotly.react('chart-canvas',fig.data,fig.layout,{responsive:true,displaylogo:false,scrollZoom:true,modeBarButtonsToRemove:['sendDataToCloud']});toast('Chart rendered');
 }catch(e){noteError(e);}
}
function saveChart(){if(!A.lastChart)return toast('Generate a chart first.',true);
 const name=A.chartSpec.title||`${A.chartSpec.kind.replaceAll('_',' ')} • ${A.chartSpec.x||'all fields'}`;
 A.savedCharts.unshift({id:Date.now(),name,spec:{...A.chartSpec},dataset:A.state.active});A.savedCharts=A.savedCharts.slice(0,35);localStorage.setItem('if_charts',JSON.stringify(A.savedCharts));drawChartPresets();toast('Chart preset saved in this browser');
}
function drawChartPresets(){const p=el('chart-presets');if(!p)return;p.innerHTML=A.savedCharts.length?A.savedCharts.map(c=>`<div class="export-item"><div><strong class="small">${esc(c.name)}</strong><p class="muted tiny" style="margin:3px 0 0">${esc(c.spec.kind)}</p></div><div><button class="button ghost mini" onclick="loadPreset(${c.id})">Load</button><button class="button danger mini" onclick="removePreset(${c.id})">×</button></div></div>`).join(''):'<p class="muted small">Charts you save will appear here.</p>';}
function loadPreset(id){const c=A.savedCharts.find(c=>c.id===id);if(!c)return;if(c.dataset!==A.state.active)toast('Preset was created for another dataset; check column names.',true);A.chartSpec={...c.spec};viewCharts();}
function removePreset(id){A.savedCharts=A.savedCharts.filter(c=>c.id!==id);localStorage.setItem('if_charts',JSON.stringify(A.savedCharts));drawChartPresets();}
const TESTS=[['pearson','Pearson Correlation'],['spearman','Spearman Correlation'],['kendall','Kendall Tau'],['linear_regression','Simple Linear Regression'],['ttest_ind','Welch Two-Sample T-Test'],['mannwhitney','Mann-Whitney U'],['anova','One-Way ANOVA'],['kruskal','Kruskal-Wallis'],['chi_square','Chi-Squared Independence'],['shapiro','Shapiro-Wilk Normality']];
function viewStats(){
 root().innerHTML=title('Statistics Lab','Perform inferential tests with SciPy using transparent assumptions and interpretable results.')+
 `<div class="grid grid-narrow"><div><div class="card card-pad">${cardTitle('Configure statistical test','Select method and columns to analyze')}
 <div class="fields cols-2">${field('Statistical test',`<select class="select" id="stats-test">${TESTS.map(z=>option(z[0],z[1])).join('')}</select>`)}${field('X column',select('stats-x',cols(),nums()[0]||cols()[0]))}
 ${field('Y column (when required)',select('stats-y',cols()))}</div>
 <div class="form-actions"><button class="button primary" onclick="runStats()">∑ Run Statistical Test</button></div><div class="notice section-gap">For two-group tests and ANOVA, X is the numeric measurement and Y is the grouping variable. For correlations, both must be numeric. Shapiro-Wilk uses X only.</div></div>
 <div class="card card-pad section-gap">${cardTitle('Results and interpretation','P-values are not effect sizes and do not prove causality')}<div id="stats-results"><div class="empty-mini">Choose a test and run it to see your results.</div></div></div></div>
 <div class="card card-pad">${cardTitle('Methods included','Ten essential statistical analyses','SCIPY')}
 ${TESTS.map(([k,label])=>`<div class="export-item"><span class="small">${esc(label)}</span><span class="tag">${esc(k)}</span></div>`).join('')}
 <div class="notice warning section-gap">These are exploratory tests. Check assumptions, multiple comparisons, sampling design, and the context of your data before drawing conclusions.</div></div></div>`;
}
async function runStats(){try{
 const r=await api('stats','POST',{test:val('stats-test'),x:val('stats-x'),y:val('stats-y')||null});const target=el('stats-results');if(!target)return;
 const metrics=Object.entries(r).filter(([k,v])=>typeof v==='number'&&k!=='p_value').slice(0,8);
 target.innerHTML=`<div class="grid grid-3" style="margin-bottom:16px">${r.p_value!=null?statInline('P-VALUE',r.p_value<.0001?r.p_value.toExponential(3):fmt(r.p_value)):''}${metrics.map(([k,v])=>statInline(esc(k.replaceAll('_',' ').toUpperCase()),fmt(v))).join('')}</div>
 <div class="notice ${r.p_value<.05?'success':''}">${esc(r.interpretation||'Analysis completed')}<br><span class="muted">${esc(r.note)}</span></div>
 ${r.warning?`<div class="notice warning section-gap">${esc(r.warning)}</div>`:''}
 <div class="divider"></div><p class="muted small">Full result:</p><pre class="raw-output">${esc(JSON.stringify(r,null,2))}</pre>`;toast('Statistical test complete');
 }catch(e){noteError(e);}
}
function viewML(){
 if(window.viewMLV2)return window.viewMLV2();
 root().innerHTML=title('Machine Learning Lab','Train and evaluate basic predictive models locally with scikit-learn and an isolated test split.',`<span class="tag cyan">CLASSIFICATION + REGRESSION</span>`)+
 `<div class="grid grid-narrow"><div><div class="card card-pad">${cardTitle('Train a model','Automated numeric/categorical preprocessing; no coding required')}
 <div class="fields cols-2">${field('Target variable',select('ml-target',cols()))}
 ${field('Learning task',`<select class="select" id="ml-task"><option value="auto">Auto detect</option><option value="classification">Classification</option><option value="regression">Regression</option></select>`)}
 ${field('Algorithm',`<select class="select" id="ml-algorithm"><option value="random_forest">Random Forest</option><option value="gradient_boosting">Gradient Boosting</option><option value="logistic_regression">Logistic Regression</option><option value="linear_regression">Linear Regression</option><option value="ridge">Ridge Regression</option></select>`)}
 ${field('Test dataset fraction',`<select class="select" id="ml-fraction"><option value="0.2">20% test / 80% train</option><option value="0.25">25% test / 75% train</option><option value="0.3">30% test / 70% train</option></select>`)}</div>
 <div class="form-actions"><button class="button primary" id="ml-run" onclick="runML()">◉ Train & Evaluate Model</button></div>
 <div class="notice warning section-gap">For research and exploration only. A strong random train/test result may still hide data leakage, biased samples, or poor performance on future real-world cases. Do not use it for clinical or other high-stakes decisions without rigorous validation.</div></div>
 <div class="card card-pad section-gap">${cardTitle('Model evaluation','Holdout metrics and important predictor signals')}<div id="ml-results">${A.mlResult?mlResultsHTML(A.mlResult):'<div class="empty-mini">Train a model to display its evaluation.</div>'}</div><div class="plot small" id="ml-plot"></div></div></div>
 <div class="card card-pad">${cardTitle('Machine learning workflow','Reproducible built-in preprocessing','SKLEARN')}
 ${[['01','Choose Target','Pick the dependent variable you want to predict.'],['02','Split Data','Deterministic 80/20 split by default, with appropriate stratification when possible.'],['03','Preprocess Features','Impute missing numbers/categories, scale numeric columns, one-hot encode categories.'],['04','Train & Evaluate','Compare predictions on held-out data.'],['05','Inspect Signals','Review metrics, class imbalance, or random-forest feature importance.']].map(x=>`<div class="export-item"><div class="export-left"><span class="tag">${x[0]}</span><div><div class="export-name">${x[1]}</div><div class="export-description">${x[2]}</div></div></div></div>`).join('')}
 <div class="divider"></div><p class="help">Runtime safeguard: a maximum of 20,000 sampled rows per training run; high-cardinality text/IDs are excluded.</p></div></div>`;
 if(A.mlResult)drawMLPlot(A.mlResult);
}
function mlResultsHTML(r){return `<div class="grid grid-3">${Object.entries(r.metrics).map(([k,v])=>`<div class="stat-card card"><div class="stat-label">${esc(k.toUpperCase())}</div><div class="stat-value" style="font-size:24px">${fmt(v)}</div></div>`).join('')}</div><div class="notice section-gap">${esc(r.disclaimer)}</div><div class="table-meta"><span>Train: ${fmt(r.train_rows)} rows</span><span>Test: ${fmt(r.test_rows)} rows</span><span>Task: ${esc(r.task)}</span></div>
 ${r.excluded_high_cardinality?.length?`<div class="notice warning">Excluded high-cardinality features: ${esc(r.excluded_high_cardinality.join(', '))}</div>`:''}
 <h3 style="margin:24px 0 12px">Evaluated Model</h3><div class="raw-output"><pre>${esc(JSON.stringify({algorithm:r.algorithm,task:r.task,target:r.target,metrics:r.metrics,disclaimer:r.disclaimer},null,2))}</pre></div>`;}
async function runML(){const btn=el('ml-run');if(btn){btn.disabled=true;btn.textContent='Training locally…';}
 try{const r=await api('ml','POST',{target:val('ml-target'),task:val('ml-task'),algorithm:val('ml-algorithm'),test_fraction:+val('ml-fraction')});A.mlResult=r;el('ml-results').innerHTML=mlResultsHTML(r);drawMLPlot(r);await refresh(false);toast('Model evaluated on holdout records');}
 catch(e){noteError(e);}finally{if(btn){btn.disabled=false;btn.textContent='◉ Train & Evaluate Model';}}
}
function drawMLPlot(r){if(r.feature_importance?.length){const values=r.feature_importance.slice(0,15).reverse();plot('ml-plot',[{type:'bar',orientation:'h',y:values.map(z=>z.feature),x:values.map(z=>z.importance),marker:{color:'#31d6c4'}}],{margin:{l:175,r:15,t:15,b:45},xaxis:{title:'Feature importance'}});}
 else if(r.confusion){plot('ml-plot',[{type:'heatmap',z:r.confusion.values,x:r.confusion.labels,y:r.confusion.labels,colorscale:'Viridis'}],{xaxis:{title:'Predicted'},yaxis:{title:'Actual'}})}
 else if(r.actual_vs_pred){plot('ml-plot',[{type:'scatter',mode:'markers',x:r.actual_vs_pred.map(d=>d.actual),y:r.actual_vs_pred.map(d=>d.predicted),marker:{color:'#7c78fa',opacity:.6}}],{xaxis:{title:'Actual'},yaxis:{title:'Predicted'}})}
}
function viewSQL(){
 const d=dataset();let name='dataset_'+d.name.replace(/\W+/g,'_').replace(/^_+|_+$/g,'').toLowerCase().slice(0,40);
 root().innerHTML=title('SQL Studio','Run read-only SQLite SELECT queries against your active table or other loaded datasets. No external database connection required.')+
 `<div class="grid grid-narrow"><div><div class="card card-pad">${cardTitle('Query editor','Available table alias: data · SQL SELECT / WITH only','READ-ONLY')}
 <textarea class="textarea code" id="sql-editor" spellcheck="false">SELECT *\nFROM data\nLIMIT 50;</textarea>
 <div class="form-actions"><button class="button primary" onclick="executeSQL()">▶ Execute Query</button><button class="button ghost" onclick="quickSQL('summary')">Aggregate Example</button><button class="button ghost" onclick="quickSQL('missing')">Missing Values Example</button></div>
 <div class="notice section-gap">Queries execute against a temporary in-memory SQLite copy. Source tables cannot be modified through SQL. Results return at most 5,000 rows.</div></div>
 <div class="card card-pad section-gap">${cardTitle('Query results','Inspect the returned rows in a scrollable table')}<div id="sql-results" class="code-table"><div class="empty-mini">Press Execute Query to see results.</div></div></div></div>
 <div class="card card-pad">${cardTitle('Available tables','Current dataset alias plus loaded datasets')}
 <div class="column-chip"><strong class="code-words">data</strong><small>Currently selected dataset</small></div>
 <div class="column-chip section-gap"><strong class="code-words">${esc(name)}</strong><small>Active dataset, named alias</small></div>
 <div class="divider"></div>${A.state.datasets.map(d=>`<p class="code-words" title="${esc(d.name)}">dataset_${esc(d.name.replace(/\W+/g,'_').replace(/^_+|_+$/g,'').toLowerCase().slice(0,40))}</p>`).join('')}
 <div class="divider"></div>${cardTitle('Quick SQL patterns','')}<pre class="raw-output">SELECT COUNT(*) AS total\nFROM data;\n\nSELECT * FROM data\nLIMIT 20;</pre>
 <div class="divider"></div>${cardTitle('Columns in active data','')}
 ${cols().slice(0,70).map(c=>`<span class="tiny-chip">${esc(c)}</span>`).join('')}</div></div>`;
}
function quickSQL(type){const n=nums()[0];const c=cols()[0];if(type==='summary')el('sql-editor').value=n?`SELECT COUNT(*) AS row_count, ROUND(AVG("${n.replaceAll('"','""')}"), 2) AS average, MIN("${n.replaceAll('"','""')}") AS minimum, MAX("${n.replaceAll('"','""')}") AS maximum FROM data;`:'SELECT COUNT(*) AS row_count FROM data;';
 else el('sql-editor').value=c?`SELECT COUNT(*) AS total_rows, SUM(CASE WHEN "${c.replaceAll('"','""')}" IS NULL THEN 1 ELSE 0 END) AS missing_values FROM data;`:'SELECT COUNT(*) FROM data;';}
async function executeSQL(){try{const r=await api('sql','POST',{query:val('sql-editor'),limit:1000});const t=el('sql-results');t.innerHTML=`<div class="table-meta"><span>${fmt(r.count)} returned rows · limit ${fmt(r.limit)}</span><span>${r.columns.length} columns</span></div>${formatTable(r.rows,r.columns)}`;toast('SQL query completed');}catch(e){noteError(e);}}
const TRANSFORMS=[
 ['groupby','Group & Aggregate','Summarize values by one or more categories'],
 ['pivot','Pivot Table','Create a cross-tab summary with measure aggregation'],
 ['crosstab','Cross Tabulation','Count categorical combinations'],
 ['merge','Merge / Join','Join two datasets on matching keys'],
 ['concat','Append Datasets','Stack records from two tables'],
 ['melt','Unpivot / Melt','Convert wide columns into long form'],
 ['sample','Random Sample','Create a reproducible dataset subset'],
 ['sort','Sort Records','Sort by one or more columns'],
 ['rolling_mean','Rolling Mean','Create a moving average field']
];
function viewTransform(){
 root().innerHTML=title('Transform & Join','Advanced Pandas recipes for grouping, pivoting, joining, melting and engineering new tables. Each operation creates a new dataset, preserving the source.')+
 `<div class="grid grid-main"><div class="card card-pad">${cardTitle('Transformation recipe','Build complex table transformations without Python code','PANDAS')}
 <div class="fields cols-2">${field('Operation',`<select id="transform-op" class="select">${TRANSFORMS.map(x=>option(x[0],x[1])).join('')}</select>`)}
 ${field('Group / Left join / Sort fields',`<select id="transform-group" class="select multi-select" multiple size="7">${cols().map(x=>option(x,x)).join('')}</select>`)}
 ${field('Numeric measure',select('transform-measure',cols()))}
 ${field('Aggregation',`<select class="select" id="transform-agg">${['sum','mean','median','count','min','max','std','nunique'].map(x=>option(x,x)).join('')}</select>`)}
 ${field('Pivot column (optional)',select('transform-pivot',cols()))}
 ${field('Join / append dataset',`<select class="select" id="transform-right">${option('','Select another dataset…')}${A.state.datasets.filter(d=>d.id!==A.state.active).map(d=>option(d.id,d.name)).join('')}</select>`)}
 ${field('Right-side join key',input('transform-key','Exact column name in second dataset'))}
 ${field('Join type / Sorting order',`<select class="select" id="transform-how">${['inner','left','right','outer','ascending','descending'].map(x=>option(x,x)).join('')}</select>`)}
 ${field('Sample size',`<input class="input" type="number" id="transform-n" min="1" value="500">`)}
 ${field('Rolling window',`<input class="input" type="number" id="transform-window" min="2" max="1000" value="7">`)}
 </div><p class="help">Use Ctrl+click to select multiple grouping columns. For Merge, select one left key in the group box, and enter the exact matching right key.</p>
 <div class="form-actions"><button class="button primary" onclick="runTransform()">⇄ Run & Create Dataset</button></div>
 <div class="notice section-gap">New tables are saved separately to your local workspace. Many-to-many merges may generate very large results and are limited for safety.</div></div>
 <div class="card card-pad">${cardTitle('Pandas operations','Built-in recipes for reproducible transformations')}
 ${TRANSFORMS.map(([id,label,desc])=>`<div class="export-item"><div><div class="export-name">${label}</div><div class="export-description">${desc}</div></div><span class="tag">${id}</span></div>`).join('')}
 </div></div>`;
 el('transform-op').onchange=()=>{if(val('transform-op')==='sort')el('transform-how').value='ascending';else if(val('transform-op')==='merge')el('transform-how').value='inner';};
}
async function runTransform(){
 const body={operation:val('transform-op'),right_id:val('transform-right')||null,
  group:Array.from(el('transform-group').selectedOptions).map(o=>o.value),
  measure:val('transform-measure')||null,agg:val('transform-agg'),pivot_column:val('transform-pivot')||null,
  right_key:val('transform-key')||null,how:val('transform-how'),n:+val('transform-n')||500,window:+val('transform-window')||7};
 try{const r=await api('transform','POST',body);A.latestEDA=null;A.lastChart=null;A.mlResult=null;await refresh();show('data');toast(`Created ${r.name}: ${fmt(r.rows)} rows`);}catch(e){noteError(e);}
}
function viewExport(){
 const formats=[['csv','CSV','Comma-separated; compatible with nearly all data tools','▤'],['xlsx','Excel Workbook','Formatted workbook with data dictionary sheet','X'],['json','JSON','Structured records for APIs and Python','{}'],['tsv','TSV','Tab-separated table','⇥'],['parquet','Parquet','Efficient columnar binary format (pyarrow required)','▥'],['sqlite','SQLite Database','Standalone table in a SQLite database file','▣']];
 root().innerHTML=title('Export Center','Save your current dataset, reports, charts, or entire local workspace in portable formats.')+
 `<div class="grid grid-main"><div><div class="card card-pad">${cardTitle('Dataset exports','Save the active dataset to your computer')}
 ${formats.map(([ext,name,desc,icon])=>`<div class="export-item"><div class="export-left"><div class="export-icon">${icon}</div><div><div class="export-name">${name}</div><div class="export-description">${desc}</div></div></div><button class="button ghost sm" onclick="download('export/${ext}')">⇩ Export</button></div>`).join('')}</div>
 <div class="card card-pad section-gap">${cardTitle('Analysis outputs','Standalone, offline shareable HTML reports')}
 <div class="export-item"><div class="export-left"><div class="export-icon">▥</div><div><div class="export-name">Automatic EDA Report</div><div class="export-description">HTML · summary, quality, statistics and data dictionary</div></div></div><button class="button ghost sm" onclick="download('report')">⇩ Export</button></div>
 <div class="export-item"><div class="export-left"><div class="export-icon">◈</div><div><div class="export-name">Interactive Plotly Chart</div><div class="export-description">Standalone HTML with the full interactive plotting library</div></div></div><button class="button ghost sm" onclick="download('chart/html')">⇩ Export</button></div>
 <div class="export-item"><div class="export-left"><div class="export-icon">▧</div><div><div class="export-name">Seaborn / Matplotlib PNG</div><div class="export-description">High-resolution static chart from your last visualization</div></div></div><button class="button ghost sm" onclick="download('chart/png')">⇩ Export</button></div>
 </div></div>
 <div class="card card-pad">${cardTitle('Workspace backup','One ZIP containing all current datasets and metadata','PORTABLE')}
 <div class="big-icon" style="color:var(--violet);font-size:66px;margin:25px 0">▧</div><h2>Protect your analysis assets</h2><p class="page-lead">Export CSV and JSON copies of every loaded dataset plus a workspace manifest. Backups can be re-imported using the ZIP importer.</p>
 <div class="form-actions"><button class="button primary" onclick="download('project')">⇩ Download Full Workspace ZIP</button></div>
 <div class="divider"></div><div class="notice success">✓ Your original imported data and edited working data are saved locally. No account, subscription, or cloud upload is required.</div>
 <div class="divider"></div><p class="muted small">Workspace folder on Windows:</p><code class="kbd">%USERPROFILE%\InsightForge Studio</code>
 <div class="divider"></div>${cardTitle('Exported content','')}
 ${['Data tables','Column dictionary','Analysis reports','Editable exports','Chart HTML / PNG','Workspace snapshot'].map(x=>`<div class="signal"><span class="bullet">✓</span>${x}</div>`).join('')}
 </div></div>`;
}
function download(path){if(!hasData())return toast('Select a dataset first',true);window.location.href='/api/'+path;}
function setup(){
 document.querySelectorAll('.nav-item').forEach(b=>b.onclick=()=>show(b.dataset.view));
 el('import-btn').onclick=()=>el('file-input').click();el('side-add').onclick=()=>show('import');
 el('file-input').onchange=e=>importFiles(e.target.files);
 el('demo-btn').onclick=loadDemo;
 el('top-analyze').onclick=()=>show('analyst');
 el('theme-toggle').onclick=()=>{const light=document.documentElement.dataset.theme==='light';document.documentElement.dataset.theme=light?'dark':'light';localStorage.setItem('if_theme',light?'dark':'light');show(A.view,false);};
 el('undo-btn').onclick=()=>action('undo');el('redo-btn').onclick=()=>action('redo');
 el('mobile-menu').onclick=()=>el('sidebar').classList.toggle('open');
 document.documentElement.dataset.theme=localStorage.getItem('if_theme')||'light';
 refresh().catch(e=>{noteError(e);root().innerHTML='<div class="no-data"><h2>Cannot connect to the local engine.</h2><p>Start the software with RUN_WINDOWS.bat, then refresh this page.</p></div>';});
}
window.studio=A;
window.show=show;window.loadDemo=loadDemo;window.closeModal=closeModal;window.action=action;window.confirmReset=confirmReset;
window.openFormula=openFormula;window.reloadTable=reloadTable;window.importPaste=importPaste;window.importURL=importURL;window.confirmDelete=confirmDelete;
window.runClean=runClean;window.runEDA=runEDA;window.makeChart=makeChart;window.saveChart=saveChart;window.loadPreset=loadPreset;window.removePreset=removePreset;
window.runTransform=runTransform;window.runStats=runStats;window.runML=runML;window.executeSQL=executeSQL;window.quickSQL=quickSQL;window.download=download;
document.addEventListener('DOMContentLoaded',setup);
