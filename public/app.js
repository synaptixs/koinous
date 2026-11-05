function viewNode(tag,text,css='') {
  const el=document.createElement(tag);el.className=css;if(text!==undefined)el.textContent=text;return el;
}
// Small, non-HTML Markdown subset. Provider text never enters innerHTML or URLs.
function inlineText(parent,text) {
  const pattern=/(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g;let start=0;
  for(const match of text.matchAll(pattern)){
    parent.append(document.createTextNode(text.slice(start,match.index)));
    const token=match[0],strong=token.startsWith('**');
    parent.append(viewNode(token[0]==='`'?'code':strong?'strong':'em',token.slice(strong?2:1,strong?-2:-1)));
    start=match.index+token.length;
  }
  parent.append(document.createTextNode(text.slice(start)));
}
function readableText(text) {
  const root=viewNode('div',undefined,'readable-text'),lines=String(text??'').replace(/\r\n/g,'\n').split('\n');
  const cells=line=>line.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(x=>x.trim());
  const add=(tag,text,parent=root)=>{const el=viewNode(tag);inlineText(el,text);parent.append(el);return el;};
  for(let i=0;i<lines.length;){
    const line=lines[i];if(!line.trim()){i++;continue;}
    if(/^\s*```/.test(line)){const code=[];i++;while(i<lines.length&&!/^\s*```/.test(lines[i]))code.push(lines[i++]);if(i<lines.length)i++;const pre=viewNode('pre');pre.append(viewNode('code',code.join('\n')));root.append(pre);continue;}
    if(i+1<lines.length&&line.includes('|')&&/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i+1])){
      const wrap=viewNode('div',undefined,'table-scroll'),table=viewNode('table'),head=viewNode('thead'),tr=viewNode('tr');
      for(const cell of cells(line))add('th',cell,tr);head.append(tr);table.append(head);const body=viewNode('tbody');i+=2;
      while(i<lines.length&&lines[i].trim()&&lines[i].includes('|')){const row=viewNode('tr');for(const cell of cells(lines[i++]))add('td',cell,row);body.append(row);}
      table.append(body);wrap.append(table);root.append(wrap);continue;
    }
    const heading=line.match(/^\s{0,3}#{1,6}\s+(.+)$/);if(heading){add('h4',heading[1]);i++;continue;}
    const bullet=line.match(/^\s*(?:([-+*])|(\d+)[.)])\s+(.+)$/);
    if(bullet){const ordered=!!bullet[2],list=viewNode(ordered?'ol':'ul');if(ordered)list.start=Number(bullet[2]);
      while(i<lines.length){const item=lines[i].match(/^\s*(?:([-+*])|(\d+)[.)])\s+(.+)$/);if(!item||!!item[2]!==ordered)break;add('li',item[3],list);i++;}root.append(list);continue;}
    if(/^\s*>/.test(line)){add('blockquote',line.replace(/^\s*>\s?/,''));i++;continue;}
    const paragraph=[line];i++;while(i<lines.length&&lines[i].trim()&&!/^\s*(#{1,6}\s|```|>|[-+*]\s|\d+[.)]\s)/.test(lines[i])&&!(i+1<lines.length&&lines[i].includes('|')&&/---/.test(lines[i+1])))paragraph.push(lines[i++]);
    add('p',paragraph.join('\n'));
  }
  return root;
}
function viewList(items,ordered=false) {
  const list=viewNode(ordered?'ol':'ul',undefined,'view-list');
  for(const text of items){const item=viewNode('li');item.append(readableText(text));list.append(item);}return list;
}
function viewSection(title,...children){const section=viewNode('section',undefined,'summary-section');section.append(viewNode('h3',title),...children);return section;}
function viewDetails(title,...children){const detail=viewNode('details',undefined,'audit-details');detail.append(viewNode('summary',title),...children);return detail;}

const $ = id => document.getElementById(id);
let sessionId = null, events = null, ready = false, busy = false, inferenceEnabled = false, webSearchAvailable = false;
const rows = [];
let participantOptions = [], providerOptions = [], nextRow = 0;
let cloudSetup = null;
const modelLists = new Map(), modelQueries = new Map();
let workflowProgress = null;
let historyLoading = false, historyPage = 1, historyQuery = '', historyPrevious = false, historyNext = false;
let historyFilters = {provider:'', model:'', from:'', to:''};
let pendingSavedSession = null;
let workspaceView='new',reviewingSaved=false,draftConfiguration=null,sessionAttempted=false;
const configurationFields=['question','context','rounds','workflowMode','author','acceptanceChecks','researchMode','researchQuery'];
function captureConfiguration(){return {fields:Object.fromEntries(configurationFields.map(id=>[id,$(id).value])),rows:rows.map(row=>({id:row.id,model:row.model.value,customMode:row.customMode})),contextOpen:$('contextDetails').open,advancedOpen:$('advancedSettings').open};}
function restoreConfiguration(snapshot){
  for(const [id,value] of Object.entries(snapshot.fields))$(id).value=value;
  rows.splice(0);$('participantChoices').replaceChildren();
  for(const saved of snapshot.rows){const row=addParticipant(participantOptions.find(option=>option.id===saved.id),saved.model);row.customMode=saved.customMode;}
  $('contextDetails').open=snapshot.contextOpen;$('advancedSettings').open=snapshot.advancedOpen;refresh(snapshot.fields.author);
}
function resetSessionView(){
  if(events)events.close();events=null;sessionId=null;pendingSavedSession=null;workflowProgress=null;sessionAttempted=false;
  $('feed').replaceChildren();$('outcome').textContent='Available after the discussion.';$('tokenDetails').replaceChildren();$('tokenTotals').textContent='Token usage not recorded yet.';
  $('status').textContent='Idle';$('calls').textContent='0';$('cost').textContent='Unknown';$('evidence').textContent='—';$('reviewNotice').textContent='';$('intervene').value='';
  for(const id of ['report','jsonReport']){$(id).style.display='none';$(id).href='#';}
  $('saveStatus').textContent='Discussions save automatically when finished.';$('send').disabled=true;$('cancel').disabled=true;
  $('savedConfiguration').replaceChildren();$('savedConfiguration').hidden=true;
}
function showSavedConfiguration(saved){
  const root=$('savedConfiguration');root.replaceChildren(viewNode('h3','Recorded setup'),readableText(saved.prompt));
  root.append(viewNode('p',(saved.workflowMode==='targeted'?'Draft + targeted review':'Full discussion')+' · '+(saved.selection?rows.map(participantLabel).join(' + '):'Participants not recorded.')));
  if(saved.targetedConfig)root.append(viewNode('p','Draft author: '+saved.targetedConfig.author));
  const details=viewDetails('Context, criteria and research');
  details.append(viewNode('h4','Supplied context'),readableText(saved.context||'No additional context recorded.'),viewNode('h4','Review criteria'));
  details.append(saved.targetedConfig?.checks?.length?viewList(saved.targetedConfig.checks):viewNode('p','No explicit review criteria recorded.'));
  details.append(viewNode('h4','Research'),viewNode('p',saved.research?saved.research.mode+' · '+saved.research.query:saved.workflow?.research?.query||'No research request recorded.'));
  root.append(details);root.hidden=false;
}
function renderWorkspace(){
  $('newWorkspace').hidden=workspaceView!=='new'||reviewingSaved;$('historyWorkspace').hidden=workspaceView!=='saved';
  $('sessionResults').hidden=workspaceView==='saved'?!reviewingSaved:!sessionId&&!sessionAttempted;
  $('workspaceTitle').textContent=workspaceView==='saved'?'Saved discussions':'Configure your discussion';
  $('workspaceSubtitle').textContent=workspaceView==='saved'?'Open recorded discussions for read-only review. Your setup draft is preserved.':'Choose your models and sources, then describe your decision.';
  for(const [id,view] of [['navNew','new'],['navSaved','saved']]){$(id).className='nav-button'+(workspaceView===view?' is-current':'');$(id).setAttribute('aria-pressed',String(workspaceView===view));$(id).disabled=busy||historyLoading;}
}
function navigateWorkspace(view){
  if(busy||historyLoading)return;
  if(view==='saved')$('workspaceNotice').textContent='';
  if(view==='new'&&(reviewingSaved||sessionId||sessionAttempted)){const snapshot=draftConfiguration;reviewingSaved=false;draftConfiguration=null;resetSessionView();if(snapshot)restoreConfiguration(snapshot);$('workspaceNotice').textContent=snapshot?'Your setup draft was restored. The saved discussion is unchanged.':'';}
  workspaceView=view;$('workspaceNotice').hidden=!$('workspaceNotice').textContent;refresh();syncSavedURL();
  $('workspaceTitle').focus?.({preventScroll:true});$('workspaceTitle').scrollIntoView?.({block:'start'});
}
function selectedHistoryFilters() { return {provider:$('savedProvider').value, model:$('savedModel').value.trim(), from:$('savedFrom').value, to:$('savedTo').value}; }
function selection() {
  const selected = rows.filter(row => row.id);
  return {providers: selected.map(row => row.id), models: Object.fromEntries(selected.map(row => [row.id, row.model.value.trim()]))};
}
function refresh(preferredAuthor) {
  const chosen = selection();
  const invalidModel = Object.values(chosen.models).some(value => value.length > 128 || (value && !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(value)));
  const selected=rows.filter(row=>row.id);
  const duplicateModel=selected.some(row=>selected.some(other=>other!==row&&other.provider===row.provider&&(!(row.model.value.trim())||!(other.model.value.trim())||(row.model.value.trim())===(other.model.value.trim()))));
  const targeted=$('workflowMode').value==='targeted';
  const previousAuthor=typeof preferredAuthor==='string'?preferredAuthor:$('author').value;
  $('author').replaceChildren();
  for(const row of selected){const option=viewNode('option',participantLabel(row));option.value=row.id;$('author').append(option);}
  $('author').value=chosen.providers.includes(previousAuthor)?previousAuthor:chosen.providers.includes('claude')?'claude':chosen.providers[0]||'';
  renderWorkflowFlow();
  const missingModel=selected.some(row=>!row.model.value.trim());
  const unavailableLocal=selected.some(row=>row.requiresInstalledModel&&!row.availableModels.includes(row.model.value.trim()));
  const pendingCloudSetup=selected.some(row=>row.provider==='ollama-cloud'&&cloudSetup?.examples.some(example=>example.model===row.model.value.trim())&&!row.availableModels.includes(row.model.value.trim()));
  const unavailableResearch=['web','both'].includes($('researchMode').value)&&!webSearchAvailable;
  const unavailableParticipant=rows.some(row=>!row.id||!participantOptions.some(option=>option.id===row.id));
  const researchEnabled=['wikipedia','web','both'].includes($('researchMode').value),badQuery=researchEnabled&&(!$('researchQuery').value.trim()||$('researchQuery').value.length>300),missingIdea=!$('question').value.trim();
  const error = !ready ? 'Provider configuration unavailable.' : unavailableParticipant ? 'Choose an available provider for every participant.' : targeted&&(rows.length!==2||selected.some(row=>row.provider==='grok'))?'Targeted review requires exactly two OpenAI, Claude or Ollama participants.': chosen.providers.length < 2 ? 'Choose at least two participants.' : chosen.providers.length>3 ? 'Choose at most three participants.' : unavailableResearch ? 'Web search is not configured on this server. Choose Wikipedia or no research.' : unavailableLocal ? 'Refresh installed models and choose a model available on this machine.' : pendingCloudSetup ? 'Register the selected cloud setup example in Ollama, then Refresh models to confirm it.' : missingModel ? 'Choose a model for every participant.' : duplicateModel ? 'For the same provider, enter two different model IDs available to your account.' : invalidModel ? 'Enter a valid model ID (up to 128 characters).' : badQuery?'Enter public search keywords (1–300 characters).':missingIdea?'Describe your idea before starting.':'';
  $('selectionError').textContent = error || (!inferenceEnabled ? 'Inference is disabled. Saved discussions can still be reviewed.' : '');
  $('run').disabled = busy || historyLoading || reviewingSaved || workspaceView!=='new' || !!error || !inferenceEnabled;
  $('researchQueryField').hidden=!researchEnabled;$('researchError').textContent=badQuery?'Enter a public query of 1–300 characters.':'';$('researchQuery').setAttribute('aria-invalid',String(badQuery));
  $('ideaError').textContent=missingIdea?'An idea is required to start.':'';$('question').setAttribute('aria-invalid',String(missingIdea));
  $('setupState').textContent=workspaceView==='saved'?(reviewingSaved?'Read-only review':'Saved history'):busy?'Discussion running':error?'Setup needed':!inferenceEnabled?'Inference disabled':'Ready to start';$('setupState').className='setup-state'+(!error&&!busy&&inferenceEnabled&&workspaceView==='new'?' is-ready':'');
  const researchLabel={none:'research off',wikipedia:'Wikipedia',web:'Brave web search',both:'Wikipedia + Brave'}[$('researchMode').value]||'research off';
  $('runConfigurationSummary').textContent=rows.length+' participants · '+rows.map(row=>(providerOptions.find(option=>option.id===row.provider)?.label||'provider not chosen')+' / '+(row.model.value.trim()||'model not chosen')).join(' + ')+' · '+(targeted?'Draft + review':'Full discussion')+' · '+researchLabel;
  $('openSaved').disabled = busy || historyLoading || !$('savedSessions').value;
  for (const id of ['savedProvider','savedModel','savedFrom','savedTo','savedSessions','refreshSaved','savedSearch','searchSaved','clearSaved']) $(id).disabled = busy || historyLoading;
  $('previousSaved').disabled = busy || historyLoading || !historyPrevious;
  $('nextSaved').disabled = busy || historyLoading || !historyNext;
  $('rounds').disabled = busy || targeted;
  for(const id of ['question','context','workflowMode','author','acceptanceChecks'])$(id).disabled=busy;
  $('usePair').disabled=busy||!participantOptions.some(r=>r.id==='claude')||!participantOptions.some(r=>r.id==='codex');
  for(const id of ['researchMode','researchQuery']) $(id).disabled = busy;
  $('participantCount').value=String(rows.length>=2?rows.length:2);
  $('participantCount').disabled=busy||!ready;
  for(const option of $('participantCount').children)if(option.value==='3')option.disabled=participantOptions.length<3;
  for(const option of $('workflowMode').children)if(option.value==='targeted')option.disabled=rows.length>2;
  $('participantCountHint').textContent=rows.length===3?'Three participants use Full discussion. Choose a provider and model for each participant. To use targeted review, choose 2 participants first.':'Default: 2 participants. Choosing 3 uses Full discussion and adds an empty participant row.';
  for (const row of rows) {
    const number=rows.indexOf(row)+1;
    row.title.textContent='Participant '+number;
    row.providerSelect.setAttribute('aria-label','Participant '+number+' provider');
    row.model.setAttribute('aria-label','Participant '+number+' model ID');
    row.modelPicker.setAttribute('aria-label','Participant '+number+(row.provider==='ollama-cloud'?' cloud models':row.provider==='ollama-local'?' registered models':' model'));
    row.role.textContent=targeted?(row.id===$('author').value?'Draft author':'Reviewer'):'Full discussion';
    row.providerSelect.disabled=busy;row.model.disabled=busy||!row.id;row.modelPicker.disabled=busy||!row.id||(row.provider==='ollama-cloud'&&cloudSetup&&!cloudSetup.endpoint)||(!row.availableModels.length&&!row.model.value.trim()&&!(row.provider==='ollama-cloud'&&cloudSetup?.examples.length));
    row.refreshModels.disabled=busy||!row.id||modelQueries.has(row.provider);
    row.model.hidden=!row.customMode;row.modelLabel.hidden=!row.customMode;row.customButton.disabled=busy||!row.id;
    row.refreshModels.textContent=!row.provider.startsWith('ollama-')&&!modelLists.has(row.provider)?'Load models':'Refresh models';
    row.refreshModels.setAttribute('aria-label',row.refreshModels.textContent+' for participant '+number);
    row.modelPicker.value=row.model.value.trim();
    const modelId=row.model.value.trim();
    const rowError=!row.id?'Choose an available provider.':!modelId?'Choose a model.':modelId.length>128||!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(modelId)?'Enter a valid model ID (up to 128 characters).':row.requiresInstalledModel&&!row.availableModels.includes(modelId)?'Refresh and choose an installed local model.':duplicateModel&&selected.some(other=>other!==row&&other.provider===row.provider&&other.model.value.trim()===modelId)?'Choose different models for this provider.':'';
    row.modelError.textContent=rowError;row.modelPicker.setAttribute('aria-invalid',String(!!rowError));row.model.setAttribute('aria-invalid',String(!!rowError));row.providerSelect.setAttribute('aria-invalid',String(!row.id));
    renderCloudSetup(row);
    for(const option of row.providerSelect.children)if(option.value)option.disabled=(targeted&&option.value==='grok')||!participantOptions.some(candidate=>candidate.provider===option.value&&!rows.some(other=>other!==row&&other.id===candidate.id));
  }
  $('plannedCalls').textContent = targeted?3:rows.length * Number($('rounds').value);
  if (!sessionId) $('maxCalls').textContent = $('plannedCalls').textContent;
  renderWorkspace();
  return !error;
}
function append(title, body, who = '') {
  const d = document.createElement('div'); d.className = 'message ' + who;
  const h = document.createElement('div'); h.className = 'meta'; h.textContent = title;
  const p = readableText(body);
  d.append(h, p); $('feed').append(d);
}
function validationNotice(validation) {
  const note=document.createElement('section');
  const invalid=validation?.status==='invalid';
  note.className='response-validation '+(invalid?'validation-invalid':'validation-info');
  const heading=document.createElement('strong');
  heading.textContent=invalid?'Validation failed — excluded from structured coverage and agreement':validation?.status==='warning'?'Length warning — usable for structured coverage and agreement':validation?.status==='valid'?'Schema checks passed — not a fact check or agreement':'Schema validation unavailable — readable formatting does not imply validity';
  note.append(heading);
  if(invalid||validation?.status==='warning'){
    const list=document.createElement('ul');
    for(const issue of validation.issues||[]){const item=document.createElement('li');item.textContent=issue.message;list.append(item);}
    note.append(list);
    const help=document.createElement('p');help.textContent='Original response preserved. Shorten the named fields to the stated limits in a future response. No automatic repair or retry was made. Character counts use UTF-16 code units.';note.append(help);
  }
  return note;
}
// Presentation only: render declared fields without assessing agreement or factual support.
// The server's outcome and coverage remain authoritative; the exact response stays available.
function comparisonShape(value) {
  return value&&typeof value==='object'&&!Array.isArray(value)
    &&Object.keys(value).length===3
    &&(value.alternative===null||(typeof value.alternative==='string'&&value.alternative.trim()))
    &&typeof value.tradeoff==='string'&&value.tradeoff.trim()
    &&typeof value.switchCondition==='string'&&value.switchCondition.trim();
}
function comparisonView(position) {
  const block=viewNode('section',undefined,'response-section');
  block.append(viewNode('h4','Decision comparison'));
  const c=position.comparison;
  if(c===undefined)block.append(viewNode('p','Not recorded.'));
  else if(!comparisonShape(c))block.append(viewNode('p','Comparison unavailable; inspect the original response.'));
  else for(const [label,value] of [['Alternative',c.alternative??'No feasible alternative declared.'],['Tradeoff / feasibility',c.tradeoff],['Switch condition',c.switchCondition]]){
    block.append(viewNode('h4',label),viewNode('p',value));
  }
  return block;
}
function peerChangeView(position) {
  const block=viewNode('section',undefined,'response-section');
  block.append(viewNode('h4','Declared response to peer review'));
  if(position.revisions===undefined)block.append(viewNode('p','Not recorded.'));
  else if(!position.revisions.length)block.append(viewNode('p','No peer responses declared.'));
  else for(const r of position.revisions)block.append(viewNode('p',r.peer+' — '+r.decision+': '+r.reason));
  block.append(viewNode('p','Participant declarations only; changes and benefits are not independently verified.'));
  return block;
}
function appendResponse(entry) {
  const title=(entry.stage||'Round '+entry.round)+' · '+entry.agent;
  if(entry.stage){append(title,entry.text,entry.agent);return;}
  const original=typeof entry.text==='string'?entry.text:'';
  const fallback=()=>{
    append(title,original,entry.agent);
    const card=$('feed').children[$('feed').children.length-1];
    if([2,3].includes(entry.round))card.append(validationNotice(entry.validation));
    card.append(viewDetails('Original response',viewNode('pre',original)));
  };
  if(![2,3].includes(entry.round)||original.length>12000){fallback();return;}
  let data;
  try {data=JSON.parse(original.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/,'$1'));} catch {fallback();return;}
  const text=value=>typeof value==='string'&&value.trim().length>0;
  const strings=value=>Array.isArray(value)&&value.every(text);
  const responses=value=>Array.isArray(value)&&value.every(p=>p&&text(p.peer)&&text(p.decision)&&text(p.reason));
  const review=entry.round===2;
  const usable=data&&typeof data==='object'&&!Array.isArray(data)&&(review
    ? responses(data.reviews)&&text(data.revisedView)&&strings(data.openQuestions)
    : text(data.direction)&&text(data.recommendation)&&text(data.rationale)&&strings(data.risks)&&strings(data.disagreements)&&strings(data.nextSteps)
      &&(data.comparison===undefined||comparisonShape(data.comparison))
      &&(data.revisions===undefined||responses(data.revisions))
      &&(data.claims===undefined||Array.isArray(data.claims)&&data.claims.every(c=>c&&text(c.id)&&text(c.kind)&&text(c.text)&&strings(c.evidenceIds)&&(c.snapshotId===null||text(c.snapshotId)))));
  if(!usable){fallback();return;}
  const node=(tag,content,css='')=>{const el=document.createElement(tag);el.className=css;if(content!==undefined)el.textContent=content;return el;};
  const card=node('article',undefined,'message response-card '+entry.agent);
  card.append(node('h3',title+' · '+(review?'Peer review':'Revised position'),'meta'));
  const body=node('div',undefined,'response-body');body.append(validationNotice(entry.validation));card.append(body);
  const section=(heading,content)=>{const block=node('section',undefined,'response-section');block.append(node('h4',heading),node('p',content));body.append(block);};
  const list=(heading,items,empty)=>{
    const block=node('section',undefined,'response-section');block.append(node('h4',heading));
    if(items.length){const ul=node('ul');for(const item of items)ul.append(node('li',item));block.append(ul);}else block.append(node('p',empty,'response-empty'));
    body.append(block);
  };
  section(review?'Revised view':'Recommendation',review?data.revisedView:data.recommendation);
  if(!review){body.append(comparisonView(data));section('Declared direction',data.direction);section('Why this approach',data.rationale);}
  const peers=node('section',undefined,'response-section');peers.append(node('h4',review?'Peer assessments':'Responses to peer critiques'));
  const declared=review?data.reviews:data.revisions;
  if(!declared?.length)peers.append(node('p',declared?'No peer responses declared.':'Revision responses were not recorded.','response-empty'));
  for(const response of declared||[]){
    const item=node('div',undefined,'peer-card');const header=node('div',undefined,'peer-heading');
    header.append(node('strong',response.peer));
    const decision=['adopted','rejected','unresolved'].includes(response.decision)?response.decision:'other';
    header.append(node('span',response.decision,'decision decision-'+decision));
    item.append(header,node('p',response.reason));peers.append(item);
  }
  body.append(peers);
  if(review)list('Open questions',data.openQuestions,'No open questions declared; this is not a verification of completeness.');
  else {
    list('Risks',data.risks,'No risks declared.');
    list('Unresolved disagreements',data.disagreements,'No disagreements declared; this does not establish agreement.');
    list('Next actions',data.nextSteps,'No next actions declared.');
    if(data.claims===undefined)section('Claims and references','Structured claims were not recorded.');
    else list('Declared claims and references',data.claims.map(c=>c.id+' · '+c.kind+': '+c.text+' — References: '+(c.evidenceIds.join(', ')||'none')+'; snapshot: '+(c.snapshotId||'none')),'No claims declared; omitted assertions may remain.');
  }
  body.append(node('p','Provider declarations only. See the final assessment for coverage, support checks and unresolved disagreements.','response-note'));
  const raw=node('details',undefined,'response-original');raw.append(node('summary','Original response'),node('pre',original));card.append(raw);
  $('feed').append(card);
}
function workflowKey() {
  return JSON.stringify({mode:$('workflowMode').value,author:$('author').value,rounds:$('rounds').value,selection:selection(),prompt:$('question').value,context:$('context').value,checks:$('acceptanceChecks').value,research:$('researchMode').value,query:$('researchQuery').value});
}
function renderWorkflowFlow() {
  const targeted=$('workflowMode').value==='targeted',author=rows.find(row=>row.id===$('author').value),reviewer=rows.find(row=>row.id&&row!==author);
  const progress=workflowProgress?.key===workflowKey()?workflowProgress:null;
  const titles=targeted?['Draft','Targeted review','Revision if needed']:['Independent views','Peer critique','Revised positions'];
  const descriptions=targeted?['The author proposes a recommendation.','The other model checks for consequential mistakes.','The author responds only to material findings.']:['Each participant develops its own recommendation.','Participants challenge the other recommendations.','Participants respond to critiques and state their final positions.'];
  $('roleNote').textContent=targeted?'Two calls by default. A third call runs only when the review identifies material findings. Each step uses a fresh request.':'Participants exchange views over the selected rounds. Each round includes every selected participant.';
  $('authorField').hidden=!targeted;$('acceptanceField').hidden=!targeted;
  $('workflowSteps').replaceChildren();$('stageTags').replaceChildren();
  for(let index=0;index<3;index++){
    const round=index+1,owner=targeted?(index===1?reviewer:author):null;
    const selected=targeted||round<=Number($('rounds').value);
    let state='planned',label=targeted&&round===3?'If needed':'Planned';
    if(!selected){state='skipped';label='Not selected';}
    else if(progress){
      if(round===3&&targeted&&progress.revision==='not-needed'){state='skipped';label='Not needed';}
      else if(progress.done.has(round)){state='done';label='Response received';}
      else if(progress.status==='Connection lost'){state='unknown';label='Status unknown';}
      else if(progress.active===round){state='active';label='Running';}
      else if(progress.stopped.has(round)){state='stopped';label='Stopped';}
      else if(['completed','partial','failed','cancelled','Failed to start'].includes(progress.status)){state='unknown';label=progress.started.has(round)?'Incomplete':progress.saved?'Not recorded':'Not reached';}
      else label='Waiting';
    }
    const step=viewNode('li',undefined,'workflow-step is-'+state),top=viewNode('div',undefined,'workflow-step-top');
    top.append(viewNode('span',String(round),'workflow-step-number'),viewNode('h3',titles[index]));
    const status=viewNode('span',label,'workflow-step-state');if(state==='active')step.setAttribute('aria-current','step');
    step.append(top,status,viewNode('p',descriptions[index],'workflow-step-description'));
    if(targeted){
      step.append(viewNode('p',owner?providerOptions.find(option=>option.id===owner.provider)?.label||owner.id:'Choose a participant','workflow-step-provider'));
      step.append(viewNode('p',owner?(owner.model.value.trim()||'Choose a model'):'Model not selected','workflow-step-model'));
      step.append(viewNode('small',(owner?'Participant '+(rows.indexOf(owner)+1)+' · ':'')+(owner?.effortMode==='model-default'?'model default effort':index===1?'medium effort':'low effort')));
    }else step.append(viewNode('p','All selected participants','workflow-step-provider'));
    $('workflowSteps').append(step);$('stageTags').append(viewNode('span',round+' · '+titles[index]+' · '+label,'tag'));
  }
  const notice=progress?(progress.status==='Connection lost'?'Connection lost. Progress is unknown; the discussion may still be running.':(progress.saved?'Saved run · ':'')+progress.status+'. Step status describes execution, not recommendation quality.'):'Planned flow · starting a discussion uses model resources.';
  if($('workflowProgress').textContent!==notice)$('workflowProgress').textContent=notice;
}
function beginWorkflowProgress(saved) {
  workflowProgress={key:workflowKey(),active:null,started:new Set(),done:new Set(),stopped:new Set(),status:saved?.status||'Preparing',revision:saved?.targeted?.revision||null,saved:!!saved};
  if(!saved)return;
  for(const event of saved.events||[])recordWorkflowEvent(event);
  // Older records have canonical replies/assessment even when their event stream is absent.
  const expected=saved.workflowMode==='targeted'?1:saved.selection?.providers.length;
  for(let round=1;round<=3;round++){
    const replies=new Set((saved.entries||[]).filter(entry=>entry.round===round&&(!saved.selection||saved.selection.providers.includes(entry.agent))).map(entry=>entry.agent));
    if(replies.size)workflowProgress.started.add(round);
    if(expected&&replies.size>=expected)workflowProgress.done.add(round);
  }
  if(saved.targeted?.draft)workflowProgress.done.add(1);
  if(saved.targeted?.review)workflowProgress.done.add(2);
  if(saved.targeted?.revision==='completed')workflowProgress.done.add(3);
  workflowProgress.active=null;workflowProgress.status=saved.status;
}
function recordWorkflowEvent(event) {
  if(!workflowProgress)return;
  if(event.type==='round.started'){workflowProgress.active=event.round;workflowProgress.started.add(event.round);workflowProgress.status='Running';}
  if(event.type==='round.completed'){workflowProgress.done.add(event.round);if(workflowProgress.active===event.round)workflowProgress.active=null;}
  if(event.type==='targeted.assessed')workflowProgress.revision=event.targeted.revision;
  if(event.type==='agent.error'||event.type==='session.error'){
    if(event.round||workflowProgress.active)workflowProgress.stopped.add(event.round||workflowProgress.active);
    workflowProgress.active=null;workflowProgress.status='Stopping';
  }
  if(event.type==='session.finished'){workflowProgress.status=event.status;workflowProgress.active=null;}
}
function participantLabel(row) {
  const label=providerOptions.find(option=>option.id===row.provider)?.label||row.id||'Choose provider';
  return 'Participant '+(rows.indexOf(row)+1)+' · '+label+' · '+(row.model.value.trim()||'Choose a model');
}
function renderCloudSetup(row) {
  row.cloudHelp.hidden=row.provider!=='ollama-cloud';
  const example=cloudSetup?.examples.find(item=>item.model===row.model.value.trim());
  row.modelPageLink.hidden=!example;row.modelPageLink.href=example?.url||'';
  row.commands.hidden=!example||!cloudSetup?.endpoint;
  row.commands.textContent=example&&cloudSetup?.endpoint?[cloudSetup.signInCommand,example.registerCommand,cloudSetup.listCommand].join('\n'):'';
  row.cloudHint.textContent=!cloudSetup?'Browse Ollama’s cloud catalog and register a cloud model in your local Ollama app, then Refresh models.':!cloudSetup.endpoint?'The configured Ollama endpoint is invalid. Fix KOINOUS_OLLAMA_URL before using these setup instructions.':example?(row.availableModels.includes(example.model)?'This model is registered on the configured daemon. Account access and quota are not verified.':'Run these commands in your terminal: sign in if needed, register the cloud reference, then return here and Refresh models. Selecting an example sends no prompt.'):'Choose a “Set up” model from the Cloud models list to see its registration commands. '+(cloudSetup.scope||'Setup examples are separate from registered models.')+(cloudSetup.verifiedOn?' Examples checked '+cloudSetup.verifiedOn+'.':'');
}
function populateModelPicker(row) {
  row.modelPicker.replaceChildren();const placeholder=viewNode('option',row.provider==='ollama-cloud'?'Choose a cloud model':'Choose a model');placeholder.value='';row.modelPicker.append(placeholder);
  for(const id of row.availableModels){const label=row.modelLabels?.[id];const option=viewNode('option',(row.provider==='ollama-cloud'?'Registered · ':'')+(label&&label!==id?label+' · '+id:id));option.value=id;row.modelPicker.append(option);}
  if(row.provider==='ollama-cloud')for(const example of cloudSetup?.examples||[])if(!row.availableModels.includes(example.model)){const option=viewNode('option','Set up · '+example.label+' · '+example.model);option.value=example.model;row.modelPicker.append(option);}
  const custom=row.model.value.trim();if(custom&&![...row.modelPicker.children].some(option=>option.value===custom)){const option=viewNode('option','Custom / saved · '+custom);option.value=custom;row.modelPicker.append(option);}
  row.modelPicker.value=row.model.value;
}
function showModelChoices(provider,data) {
  modelLists.set(provider,data);
  for(const row of rows.filter(r=>r.provider===provider)){
    row.modelStatus.className='model-status';
    row.availableModels=[...data.models];
    row.modelLabels=data.labels||{};
    populateModelPicker(row);
    row.modelStatus.textContent=provider.startsWith('ollama-')?(data.source==='mock'?'Demo models. ':'')+data.models.length+' of '+data.total+' registered models'+(data.truncated?' (list truncated)':'')+'. '+(data.unsupported?data.unsupported+' unsupported entries omitted. ':'')+(row.requiresInstalledModel&&!data.models.length?'No local models installed; choose another provider or refresh after installing one. ':provider==='ollama-cloud'&&!data.models.length?'No cloud models registered on this daemon. Use the setup help below. ':'')+'No inference requested.':(data.source==='mock'?'Mock catalog. ':'Provider catalog. ')+data.models.length+(data.total===null?' entries shown; total unknown':' of '+data.total+' entries shown')+(data.truncated?' (list truncated)':'')+'. '+(data.omitted?data.omitted+' unsupported entries omitted. ':'')+'Account access is not verified. No inference requested.';
  }
}
function configureParticipant(row,capability,modelValue) {
  Object.assign(row,{id:capability?.id||'',provider:capability?.provider||'',defaultModel:capability?.defaultModel||'',modelLabels:{},modelDiscovery:!!capability?.modelDiscovery||['codex','claude','grok'].includes(capability?.provider),requiresInstalledModel:!!capability?.requiresInstalledModel,effortMode:capability?.effortMode,availableModels:[]});
  row.providerSelect.value=row.provider;
  row.model.value=modelValue??'';row.customMode=false;
  row.model.placeholder='Enter an explicit model ID';
  row.note.textContent=!row.id?'Choose a provider to view its model catalog.':row.provider==='ollama-local'?'Runs on this device. An installed model is required.':row.provider==='ollama-cloud'?'Runs in Ollama Cloud through your local daemon.':'Runs in the provider cloud using your account login.';
  row.discovery.hidden=false;
  row.pickerLabel.textContent=row.provider==='ollama-cloud'?'Cloud models':row.provider==='ollama-local'?'Registered models':'Model';populateModelPicker(row);
  row.modelStatus.textContent='No model list requested.';
  row.modelStatus.className='model-status';
  if(modelLists.has(row.provider))showModelChoices(row.provider,modelLists.get(row.provider));
}
function addParticipant(capability,modelValue) {
  if(rows.length>=3)return;
  const key=++nextRow,card=viewNode('div',undefined,'choice participant-choice');
  const title=viewNode('h3'),role=viewNode('span','','participant-role'),providerLabel=viewNode('label','Provider'),providerSelect=viewNode('select');providerSelect.id='participant-provider-'+key;providerLabel.htmlFor=providerSelect.id;
  const placeholder=viewNode('option','Choose provider');placeholder.value='';providerSelect.append(placeholder);
  for(const provider of providerOptions){const option=viewNode('option',provider.label);option.value=provider.id;providerSelect.append(option);}
  const modelLabel=viewNode('label','Custom model ID'),model=viewNode('input');model.type='text';model.id='participant-model-'+key;modelLabel.htmlFor=model.id;model.maxLength=128;model.autocomplete='off';
  const note=viewNode('small'),discovery=viewNode('div',undefined,'model-discovery'),modelPicker=viewNode('select'),pickerLabel=viewNode('label','Registered models');modelPicker.id='participant-models-'+key;pickerLabel.htmlFor=modelPicker.id;
  const refreshModels=viewNode('button','Refresh models','secondary');refreshModels.type='button';
  const modelStatus=viewNode('small','No model list requested.','model-status'),modelError=viewNode('small','','model-error');modelStatus.setAttribute('role','status');modelError.id='participant-error-'+key;modelStatus.id='participant-status-'+key;modelPicker.setAttribute('aria-describedby',modelStatus.id+' '+modelError.id);providerSelect.setAttribute('aria-describedby',modelError.id);
  discovery.append(pickerLabel,modelPicker,refreshModels,modelStatus);
  const cloudHelp=viewNode('details',undefined,'ollama-cloud-help'),helpTitle=viewNode('summary','Find and register a cloud model');
  const cloudHint=viewNode('p'),commands=viewNode('pre',undefined,'ollama-setup-commands');
  const catalogLink=viewNode('a','Browse all cloud models');catalogLink.href=cloudSetup?.catalogUrl||'https://ollama.com/search?c=cloud';catalogLink.target='_blank';catalogLink.rel='noopener noreferrer';
  const docsLink=viewNode('a','Ollama setup guide');docsLink.href=cloudSetup?.docsUrl||'https://docs.ollama.com/cloud';docsLink.target='_blank';docsLink.rel='noopener noreferrer';
  const modelPageLink=viewNode('a','Selected model details');modelPageLink.target='_blank';modelPageLink.rel='noopener noreferrer';
  const links=viewNode('div',undefined,'ollama-setup-links');links.append(catalogLink,modelPageLink,docsLink);
  cloudHelp.append(helpTitle,cloudHint,commands,viewNode('small','Keep Ollama running. Commands target the same daemon as synqo. Cloud models run remotely; registration does not start a conversation.'),links);discovery.append(cloudHelp);
  const customButton=viewNode('button','Enter a custom model ID','secondary');customButton.type='button';
  const row={card,title,role,providerSelect,model,note,discovery,modelPicker,refreshModels,modelStatus,modelError,cloudHelp,commands,cloudHint,modelPageLink,pickerLabel,customButton,modelLabel};rows.push(row);
  customButton.onclick=()=>{if(!busy&&row.id){row.customMode=!row.customMode;refresh();}};
  configureParticipant(row,capability,modelValue);card.append(title,role,providerLabel,providerSelect,modelLabel,model,note,discovery,modelError,customButton);$('participantChoices').append(card);
  providerSelect.onchange=()=>{
    if(busy)return;
    const wasAuthor=$('author').value===row.id;
    const capability=participantOptions.find(option=>option.provider===providerSelect.value&&!rows.some(other=>other!==row&&other.id===option.id));
    configureParticipant(row,capability);
    refresh(wasAuthor?row.id:undefined);
  };
  model.oninput=()=>{populateModelPicker(row);refresh();};
  modelPicker.onchange=()=>{if(!busy){model.value=modelPicker.value;row.customMode=false;refresh();}};
  refreshModels.onclick=async()=>{
    const provider=row.provider;
    if(busy||!row.id||modelQueries.has(provider))return;
    const query={};modelQueries.set(provider,query);for(const other of rows.filter(r=>r.provider===provider))other.modelStatus.className='model-status';refresh();modelStatus.textContent='Reading provider model metadata…';
    try{
      const response=await fetch('/api/models?provider='+encodeURIComponent(provider)),data=await response.json();
      if(!response.ok)throw Error(data.error||'Model list unavailable.');
      if(modelQueries.get(provider)===query)showModelChoices(provider,data);
    }catch(error){
      modelLists.delete(provider);
      for(const other of rows.filter(r=>r.provider===provider)){other.availableModels=[];populateModelPicker(other);other.modelStatus.textContent=error.message;other.modelStatus.className='model-status is-error';}
    }finally{if(modelQueries.get(provider)===query)modelQueries.delete(provider);refresh();}
  };
  return row;
}
function setParticipants(chosen) {
  rows.splice(0);$('participantChoices').replaceChildren();
  for(const id of chosen.providers){
    const capability=participantOptions.find(option=>option.id===id);
    const row=addParticipant(capability,chosen.models[id]||'');
    if(!capability&&row){row.id=id;const unavailable=viewNode('option','Unavailable on this server: '+id);unavailable.value='';row.providerSelect.replaceChildren(unavailable);row.note.textContent='Saved participant is unavailable on this server. Choose an enabled provider to start a new discussion.';
      for(const provider of providerOptions){const option=viewNode('option',provider.label);option.value=provider.id;row.providerSelect.append(option);}
    }
  }
  while(rows.length<2)addParticipant();
}
const configurationReady = fetch('/api/health').then(async response => {
  if (!response.ok) throw Error('Configuration unavailable');
  const health = await response.json();
  cloudSetup=health.ollamaCloudSetup||null;
  inferenceEnabled = health.mode === 'mock' || health.inferenceEnabled === true;
  webSearchAvailable=health.research?.web===true;
  for(const option of $('researchMode').children)if(['web','both'].includes(option.value))option.disabled=!webSearchAvailable;
  $('researchStatus').textContent=webSearchAvailable?'Wikipedia and web search are available. Research is optional and off by default.':'Wikipedia is available. Web search is not configured on this server. Research is optional and off by default.';
  $('providers').textContent = health.mode === 'mock' ? 'Mock mode · no model calls' : 'OpenAI/Claude: personal or enterprise account login · Ollama: cloud sign-in or local models';
  participantOptions=(health.availableParticipants||health.availableProviders).map(option=>({...option,provider:option.provider||option.id}));
  providerOptions=[...new Set(participantOptions.map(option=>option.provider))].map(id=>({id,label:health.availableProviders?.find(option=>option.id===id)?.label||participantOptions.find(option=>option.provider===id).label}));
  const ids=health.agents.filter(id=>participantOptions.some(option=>option.id===id)&&($('workflowMode').value!=='targeted'||participantOptions.find(option=>option.id===id).provider!=='grok')).slice(0,2);
  while(ids.length<2){const next=participantOptions.find(option=>!ids.includes(option.id)&&($('workflowMode').value!=='targeted'||option.provider!=='grok'));if(!next)break;ids.push(next.id);}
  setParticipants({providers:ids,models:{}});
  ready = true; refresh();
}).catch(() => { $('providers').textContent = 'Provider configuration unavailable'; refresh(); });
$('rounds').onchange = refresh;
$('workflowMode').onchange=refresh;$('author').onchange=refresh;
$('researchMode').onchange=refresh;
for(const id of ['question','context','acceptanceChecks','researchQuery'])$(id).oninput=refresh;
$('participantCount').onchange=()=>{
  const count=Number($('participantCount').value),author=$('author').value;
  if(busy||!ready||![2,3].includes(count)||(count===3&&participantOptions.length<3)){refresh();return;}
  if(count===3)$('workflowMode').value='discussion';
  while(rows.length<count)addParticipant();
  rows.splice(count);$('participantChoices').replaceChildren(...rows.map(row=>row.card));refresh(author);
};
$('navNew').onclick=()=>navigateWorkspace('new');$('navSaved').onclick=()=>navigateWorkspace('saved');
$('usePair').onclick=()=>{if(busy||$('usePair').disabled)return;setParticipants({providers:['codex','claude'],models:{codex:'gpt-6-astra',claude:'claude-sonnet-5-5'}});$('workflowMode').value='targeted';refresh('claude');};
function finish(status) {
  if(workflowProgress){workflowProgress.status=status;workflowProgress.active=null;}
  busy = false; $('status').textContent = status; $('send').disabled = true; $('cancel').disabled = true;
  if (events) events.close(); refresh();
}
$('run').onclick = async () => {
  if (busy || historyLoading || reviewingSaved || workspaceView!=='new' || !refresh() || !inferenceEnabled) return;
  const request = {prompt: $('question').value, context: $('context').value, grounding: 'none', maxRounds: Number($('rounds').value), selection: selection(),workflowMode:$('workflowMode').value};
  if(request.workflowMode==='targeted'){request.maxRounds=3;request.author=$('author').value;request.checks=$('acceptanceChecks').value.split('\n').map(s=>s.trim()).filter(Boolean);}
  if(['wikipedia','web','both'].includes($('researchMode').value))request.research={mode:$('researchMode').value,query:$('researchQuery').value};
  beginWorkflowProgress();sessionId = null; sessionAttempted=true; pendingSavedSession=null; syncSavedURL(); busy = true; $('reviewNotice').textContent = ''; $('saveStatus').textContent = 'Saving discussion events as they arrive. The finished session will appear in Saved discussions.'; refresh();
  if (events) events.close();
  $('outcome').textContent = 'Available after the discussion.'; $('evidence').textContent = 'Idea and optional context';
  $('feed').replaceChildren(); $('status').textContent = 'Creating'; $('calls').textContent = '0'; $('cost').textContent = 'Unknown'; $('report').style.display = 'none';$('jsonReport').style.display='none';$('tokenTotals').textContent='Awaiting token accounting';$('tokenDetails').replaceChildren();
  $('sessionResults').focus?.({preventScroll:true});$('sessionResults').scrollIntoView?.({block:'start'});
  try {
    const response = await fetch('/api/sessions', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(request)});
    const data = await response.json(); if (!response.ok) throw Error(data.error);
    sessionId = data.id; const startedSessionId=data.id; $('send').disabled = request.workflowMode==='targeted'; $('cancel').disabled = false;refresh();
    events = new EventSource('/api/sessions/' + sessionId + '/events');
    events.onmessage = event => {
      if(sessionId!==startedSessionId||!busy)return;
      const x = JSON.parse(event.data);recordWorkflowEvent(x);renderWorkflowFlow();
      switch (x.type) {
        case 'participants.configured': $('maxCalls').textContent = x.maxCalls; append('Selected participants', x.agents.map(id => id + ': ' + (x.selection?.models[id] || 'SDK default')).join('\n')); break;
        case 'runtime.preparing': $('status').textContent = 'Preparing runtime'; append('Runtime · ' + x.agent, 'Provisioning and verifying the isolated runtime before model calls'); break;
        case 'runtime.ready': append('Runtime · ' + x.agent, 'Sandbox and provider account authentication verified'); break;
        case 'runtime.cleaning': $('status').textContent = 'Cleaning up'; append('Runtime · ' + x.agent, 'Cleaning credentials and removing the disposable runtime'); break;
        case 'runtime.cleaned': append('Runtime · ' + x.agent, 'Runtime cleanup completed'); break;
        case 'research.started': $('status').textContent='Researching'; append('Research query',x.query); break;
        case 'research.completed': $('evidence').textContent=x.sources.length+' research sources'+(x.providers?' · '+x.providers.join(' + '):''); append('Research coverage',(x.scope||'Limited research; detailed source coverage was not recorded.')+(Array.isArray(x.coverage)?'\n'+x.coverage.map(c=>c.source+': '+c.returned+' of '+c.received+' returned candidates retained; '+c.resultsOmitted+' omitted. Total relevant sources unknown.'+(c.excerptsTruncated?' Excerpts truncated.':'')).join('\n'):''));append('Retrieved sources',x.sources.map(s=>s.id+' · '+(s.title?s.title+' · ':'')+s.uri+'\n'+s.text).join('\n\n')); break;
        case 'targeted.assessed': showTargeted(x.targeted); break;
        case 'workflow.assessed': showWorkflow(x.workflow); break;
        case 'grounding.skipped': $('evidence').textContent = 'Idea and optional context'; break;
        case 'discussion.assessed': showOutcome(x.outcome); break;
        case 'position.invalid': append('Final position unavailable · ' + x.agent, x.reason); break;
        case 'grounding.pinned': $('evidence').textContent = x.snapshotId; break;
        case 'round.started': $('status').textContent = 'Running'; append(x.stage||'Round ' + x.round, x.stage?'One fresh request for this stage':'Providers are running in parallel'); break;
        case 'agent.started': $('calls').textContent = x.call; break;
        case 'agent.completed': appendResponse(x); $('cost').textContent = '$' + Number(x.spendKnownUSD).toFixed(4) + (x.spendIncomplete ? ' (partial; unknown costs)' : ' (accounting value)'); break;
        case 'agent.error': append('Provider error · ' + x.agent, x.error); break;
        case 'human.intervention': append('Human intervention', x.message); break;
        case 'session.error': append('Error', x.error); break;
        case 'session.finished': showTokens(x.tokenAccounting); finish(x.status);$('jsonReport').href='/api/sessions/'+sessionId+'/report?format=json';$('jsonReport').style.display='inline'; $('cost').textContent = '$' + Number(x.spendKnownUSD).toFixed(4) + (x.spendIncomplete ? ' (partial; unknown costs)' : ' (accounting value)'); $('report').href = '/api/sessions/' + sessionId + '/report'; $('report').style.display = 'inline'; syncSavedURL();
          $('saveStatus').textContent='Saved automatically. Updating Saved discussions…';
          void loadSavedList(historyPage,historyQuery,historyFilters,true,{id:startedSessionId,status:x.status,prompt:request.prompt}); break;
      }
    };
    events.onerror = () => { if(sessionId!==startedSessionId||!busy)return; append('Connection lost', 'The discussion may still be running. Reloading or starting again does not cancel it.'); events.close(); $('status').textContent = 'Connection lost';$('saveStatus').textContent='Completion has not been confirmed. Reload to check Saved discussions; this does not cancel the running session.';if(workflowProgress){workflowProgress.active=null;workflowProgress.status='Connection lost';renderWorkflowFlow();} };
  } catch (error) { append('Error', error.message); $('saveStatus').textContent='Discussion did not start; no finished session was confirmed.'; finish('Failed to start'); }
};
$('send').onclick = async () => {
  const message = $('intervene').value.trim(); if (!sessionId || !message) return;
  const response = await fetch('/api/sessions/' + sessionId + '/interventions', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({message})});
  if (response.ok) $('intervene').value = ''; else append('Error', (await response.json()).error);
};
$('cancel').onclick = async () => { if (sessionId) await fetch('/api/sessions/' + sessionId + '/cancel', {method: 'POST'}); };

function showTokens(accounting){
  $('tokenDetails').replaceChildren();
  if(!accounting){$('tokenTotals').textContent='Token accounting unavailable for this record.';return;}
  $('tokenTotals').textContent=accounting.knownTotalTokens.toLocaleString()+' known total tokens · '+accounting.missingCalls+' calls missing usage';
  const table=viewNode('table'),head=viewNode('tr');for(const title of ['Participant / stage','Input','Output','Total','Primary','Helpers','Unclassified','Time (ms)'])head.append(viewNode('th',title));table.append(head);
  const show=v=>v===null||v===undefined?'unknown':v.toLocaleString();
  for(const c of accounting.calls){const row=viewNode('tr');for(const v of [c.agent+' / '+c.stage,show(c.inputTokens),show(c.outputTokens),show(c.totalTokens),show(c.primaryTokens),show(c.auxiliaryTokens),show(c.unclassifiedTokens),show(c.durationMs)])row.append(viewNode('td',v));table.append(row);}
  const wrap=viewNode('div',undefined,'table-scroll');wrap.append(table);$('tokenDetails').append(wrap,viewNode('p',accounting.scope));
}
function showTargeted(a){
  const root=$('outcome');root.replaceChildren();
  const hero=viewSection(a.complete?'Targeted review complete':'Targeted review incomplete',readableText(a.final?.recommendation||'No usable draft.'));
  hero.append(viewNode('p',a.reason),viewNode('p','Author: '+a.author+' · Reviewer: '+a.reviewer+' · Revision: '+a.revision));root.append(hero);
  if(a.final)root.append(viewSection('Why this approach',readableText(a.final.rationale)),viewSection('Next actions',viewList(a.final.nextSteps,true)),viewSection('Risks',viewList(a.final.risks)));
  const findings=viewSection('What the reviewer flagged');
  for(const f of a.review?.findings||[])findings.append(viewSection(f.id+' · '+f.severity+' / '+f.category,viewNode('p','Reference: '+f.claimId),readableText(f.failureScenario),readableText('Consequence: '+f.consequence),readableText('Correction: '+f.correction),readableText('Acceptance test: '+f.acceptanceTest)));
  if(!a.review)findings.append(viewNode('p','No valid review available.'));else if(!a.review.findings.length)findings.append(viewNode('p','No material issue found. This is not proof of correctness.'));
  root.append(findings,viewSection('What changed',viewNode('p','Changed fields: '+(a.changedFields.join(', ')||'none')),viewList(a.responses.map(r=>r.findingId+' — '+r.decision+': '+r.reason+' Change: '+(r.change||'none')))));
  root.append(viewNode('p','Reviewer findings and author responses are model declarations. Addressed does not mean independently verified.'));
  root.append(viewDetails('Original draft',viewNode('pre',JSON.stringify(a.draft,null,2))),viewDetails('Final answer and claims',viewNode('pre',JSON.stringify(a.final,null,2))));
}
function showWorkflow(w) {
  const card=viewNode('article',undefined,'message coverage-card'),body=viewNode('div');
  card.append(viewNode('h3','Research and collaboration coverage','meta'),body);
  body.append(viewNode('p',w.complete?'Declared coverage complete.':'Coverage incomplete or unassessed.','coverage-status'),readableText(w.research.status+': '+w.research.scope));
  const grid=viewNode('div',undefined,'summary-grid');
  for(const r of w.rows){const item=viewSection(r.agent,viewNode('p',`Peer reviews ${r.reviewed.length}/${r.expected.length} · Critique responses ${r.responded.length}/${r.expected.length}`));
    item.append(viewList(['Missing reviews: '+(r.missingReviews.join(', ')||'none'),'Missing revisions: '+(r.missingRevisions.join(', ')||'none')]));
    if(r.responded.length)item.append(viewDetails('Peer responses',viewList(r.responded.map(x=>x.peer+': '+x.decision+' — '+x.reason))));
    if(r.openQuestions.length)item.append(viewDetails('Open questions',viewList(r.openQuestions)));grid.append(item);
  }
  body.append(grid,viewDetails('How coverage is assessed',readableText(w.scope)));$('feed').append(card);
  if(w.research.sources)append('Research sources',w.research.sources.map(s=>s.id+' · '+s.uri+'\n'+s.text).join('\n\n'));
}
function showOutcome(o) {
  const root=$('outcome');root.replaceChildren();
  const statusLabels={'direction-alignment':'Aligned direction · proposals differ','majority-direction':'Majority direction','split':'Different directions','insufficient':'Insufficient final positions','agreement':'Agreement recorded'};
  const hero=viewNode('section',undefined,'recommendation-hero');
  const badges=viewNode('div',undefined,'assessment-badges');badges.append(viewNode('span',statusLabels[o.status]||o.status,'assessment-badge'),viewNode('span',`Final positions: ${o.coverage.valid}/${o.coverage.expected}`,'assessment-badge'));
  hero.append(badges,readableText(o.recommendation),viewNode('p',o.proposalBy?'Proposal by '+o.proposalBy+'; direction supported by '+o.supporters.join(', '):'Procedural fallback; no majority recommendation','proposal-credit'));
  root.append(hero);
  // Keep the canonical caveat visible; no UI inference about consensus or support.
  root.append(viewNode('p',o.caveat,'assessment-caveat'));
  root.append(viewSection('Next actions',viewList(o.nextSteps,true)));
  const reasons=viewNode('div',undefined,'summary-grid');
  for(const p of o.positions){const card=viewSection(p.agent+' · Decision brief',readableText(p.position.recommendation||'Proposal not recorded.'));
    card.append(comparisonView(p.position),viewNode('h4','Why this approach'),readableText(p.position.rationale),peerChangeView(p.position));
    card.append(viewNode('h4','Risks and tradeoffs'),p.position.risks.length?viewList(p.position.risks):viewNode('p','No risks declared.'));reasons.append(card);}
  root.append(reasons);
  const disagreements=o.positions.flatMap(p=>(p.position.disagreements||[]).map(text=>p.agent+': '+text));
  root.append(viewSection('Where the providers differ',disagreements.length?viewList(disagreements):viewNode('p','No disagreements declared in final positions; other assessment gaps may remain.')));
  root.append(viewDetails(`All unresolved disagreements and gaps (${o.unresolved.length})`,o.unresolved.length?viewList(o.unresolved.map(x=>x.agent+': '+x.text)):viewNode('p','None declared; this does not prove correctness.')));
  const a=o.claimAssessment;
  if(a){const checks=viewNode('div',undefined,'claim-checks');checks.append(readableText(a.scope),viewNode('p',`Structured declarations: ${a.declaredBy.length}/${o.coverage.expected}; unassessed: ${a.unassessed.join(', ')||'none'}`));
    for(const c of a.checks){const card=viewSection(c.agent+'/'+c.claim.id+' ('+c.status+')',readableText(c.claim.text));card.append(viewNode('p','References: '+(c.claim.evidenceIds.join(', ')||'none')+'; snapshot: '+(c.claim.snapshotId||'none')),viewList(c.issues));checks.append(card);}
    if(!a.checks.length)checks.append(viewNode('p','No structured claims declared; omitted factual assertions may remain.'));
    const unsupported=a.checks.filter(c=>c.status==='unsupported').length;
    root.append(viewDetails(`Claims and support checks (${a.checks.length}; ${unsupported} unsupported)`,checks));
  }else root.append(viewDetails('Claims and support checks',viewNode('p','Claim assessment was not recorded; support is unassessed.')));
}

// URL state represents the successfully applied view, never an unsubmitted draft.
function syncSavedURL() {
  if (busy || typeof location === 'undefined' || typeof history === 'undefined') return;
  const params = new URLSearchParams(location.search);
  for (const key of ['q','page','provider','model','from','to','session','view']) params.delete(key);
  params.set('view',workspaceView);
  if (historyQuery) params.set('q', historyQuery);
  params.set('page', String(historyPage));
  for (const [key,value] of Object.entries(historyFilters)) if (value) params.set(key,value);
  if (sessionId) params.set('session',sessionId);
  history.replaceState(null, '', location.pathname + '?' + params.toString() + location.hash);
}

async function loadSavedList(page = historyPage, query = historyQuery, filters = historyFilters, updateURL = true, justFinished = pendingSavedSession) {
  if (historyLoading || busy) return;
  if(justFinished)pendingSavedSession=justFinished;
  historyLoading = true; refresh();
  try {
    const response = await fetch('/api/sessions?page=' + encodeURIComponent(page) + '&pageSize=50&q=' + encodeURIComponent(query.trim()) + Object.entries(filters).map(([key,value]) => '&' + key + '=' + encodeURIComponent(value)).join(''));
    if (!response.ok) { const failure = await response.json(); throw Error(failure.error || 'Saved discussions unavailable.'); }
    const data = await response.json();
    historyPage = data.page; historyQuery = data.q; historyPrevious = data.hasPrevious; historyNext = data.hasNext;
    historyFilters = data.filters || {provider:'',model:'',from:'',to:''};
    for (const [key,id] of Object.entries({provider:'savedProvider',model:'savedModel',from:'savedFrom',to:'savedTo'})) $(id).value = historyFilters[key];
    $('savedSearch').value = data.q;
    $('savedPage').textContent = 'Page ' + data.page + ' of ' + data.totalPages;
    const previous = $('savedSessions').value;
    $('savedSessions').replaceChildren();
    const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Select a saved discussion'; $('savedSessions').append(placeholder);
    for (const s of data.sessions) {
      const option = document.createElement('option'); option.value = s.id;
      option.textContent = s.createdAt + ' · ' + s.status + ' · ' + s.prompt.slice(0,100);
      $('savedSessions').append(option);
    }
    const outsideResults=justFinished&&!data.sessions.some(s=>s.id===justFinished.id);
    if(outsideResults){const option=viewNode('option','Just finished · '+justFinished.status+' · '+justFinished.prompt.slice(0,100));option.value=justFinished.id;$('savedSessions').append(option);}
    $('savedSessions').value = justFinished?.id || (data.sessions.some(s => s.id === previous) ? previous : '');
    const first = data.total ? (data.page - 1) * data.pageSize + 1 : 0;
    const last = data.total ? first + data.sessions.length - 1 : 0;
    $('savedStatus').textContent = 'Showing ' + first + '–' + last + ' of ' + data.total + ' matching discussions (' + data.discoveredTotal + ' readable discovered).' + (data.scanTruncated ? ' Discovery is partial; unscanned folders may contain more matches.' : '') + ' ' + data.unavailable + ' incomplete, invalid, or ambiguous records unavailable.';
    if(outsideResults)$('savedStatus').textContent+=' The Just finished option is outside these results and is not included in the matching count.';
    if(justFinished){const message='Session '+justFinished.status+' · saved automatically. Selected in Saved discussions; use Open saved discussion to review it.';$('saveStatus').textContent=message;$('reviewNotice').textContent=message;pendingSavedSession=null;}
    if (updateURL) syncSavedURL();
    return true;
  } catch (error) {
    $('savedStatus').textContent = error.message;
    $('savedSessions').replaceChildren(); $('savedSessions').value = '';
    historyPrevious = false; historyNext = false; $('savedPage').textContent = 'Page unavailable';
    if(justFinished){const message='Session '+justFinished.status+' · saved automatically, but the list could not refresh. Use Refresh list to retry; report downloads remain available.';$('saveStatus').textContent=message;$('reviewNotice').textContent=message;}
    return false;
  }
  finally { historyLoading = false; refresh(); }
}
async function openSaved(id) {
  if (busy || !id) return;
  busy = true; refresh();
  try {
    await configurationReady;
    const response = await fetch('/api/sessions/' + encodeURIComponent(id));
    const s = await response.json();
    if (!response.ok) throw Error(s.error || 'Saved discussion unavailable.');
    if (!s.readOnly) throw Error('This discussion is still active; wait until it finishes.');
    if(!reviewingSaved)draftConfiguration=captureConfiguration();
    reviewingSaved=true;workspaceView='saved';$('workspaceNotice').hidden=true;
    if (events) events.close();
    sessionId = s.id;
    $('feed').replaceChildren();
    $('question').value = s.prompt; $('context').value = s.context || '';
    $('rounds').value = String(s.maxRounds);$('workflowMode').value=s.workflowMode||'discussion';$('author').value=s.targetedConfig?.author||'';$('acceptanceChecks').value=(s.targetedConfig?.checks||[]).join('\n');
    $('researchMode').value=s.research?.mode||(s.workflow?.research.status==='completed'?'wikipedia':'none');
    $('researchQuery').value=s.research?.query||s.workflow?.research.query||'';
    if (s.selection) setParticipants(s.selection);
    refresh(s.targetedConfig?.author);showSavedConfiguration(s);beginWorkflowProgress(s);renderWorkflowFlow();
    $('calls').textContent = s.calls; $('maxCalls').textContent = s.maxCalls ?? 'Unknown';
    $('cost').textContent = '$' + Number(s.spendKnownUSD).toFixed(4) + (s.spendIncomplete ? ' (partial; unknown costs)' : ' (accounting value)');
    $('evidence').textContent = s.evidence ? s.evidence.id : 'Idea and optional context';
    if (s.selection) append('Selected participants', s.selection.providers.map(id => id + ': ' + (s.selection.models[id] || 'SDK default')).join('\n'));
    for (let round=1; round<=s.maxRounds; round++) {
      append('Round ' + round, 'Saved responses');
      for (const entry of s.entries.filter(e => e.round === round)) appendResponse(entry);
    }
    for (const failure of s.failures || []) append('Recorded failure · ' + (failure.agent || 'session'), failure.error || failure.reason || failure.type);
    if(s.workflow)showWorkflow(s.workflow);
    showTokens(s.tokenAccounting);$('jsonReport').href='/api/sessions/'+sessionId+'/report?format=json';$('jsonReport').style.display='inline';
    if(s.targeted)showTargeted(s.targeted);else if (s.outcome) showOutcome(s.outcome); else $('outcome').textContent = 'No agreement assessment was recorded for this older discussion. Review the original transcript and report.';
    $('reviewNotice').textContent = 'Reviewing saved discussion ' + s.id + ' · read-only. No model calls were made to open it.';
    $('saveStatus').textContent='Saved discussion · read-only review.';
    $('report').href = '/api/sessions/' + sessionId + '/report'; $('report').style.display = 'inline';
    finish(s.status);
    syncSavedURL();
    $('savedConfiguration').focus?.({preventScroll:true});$('savedConfiguration').scrollIntoView?.({block:'start'});
  } catch (error) { $('savedStatus').textContent = error.message; }
  finally { busy = false; refresh(); }
}
$('savedSessions').onchange = refresh;
$('openSaved').onclick = () => openSaved($('savedSessions').value);
$('refreshSaved').onclick = () => loadSavedList();
$('searchSaved').onclick = () => loadSavedList(1, $('savedSearch').value, selectedHistoryFilters());
$('clearSaved').onclick = () => loadSavedList(1, '', {provider:'',model:'',from:'',to:''});
$('savedSearch').onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); void loadSavedList(1, $('savedSearch').value, selectedHistoryFilters()); } };
$('previousSaved').onclick = () => historyPrevious ? loadSavedList(historyPage - 1) : Promise.resolve();
$('nextSaved').onclick = () => historyNext ? loadSavedList(historyPage + 1) : Promise.resolve();
async function restoreSavedView() {
  const params = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
  workspaceView=params.has('session')||params.get('view')==='saved'||(!params.has('view')&&(['q','provider','model','from','to'].some(key=>params.has(key))||Number(params.get('page'))>1))?'saved':'new';
  const filters = Object.fromEntries(['provider','model','from','to'].map(key => [key,params.get(key)||'']));
  const query = params.get('q') || '';
  $('savedSearch').value = query;
  for (const [key,id] of Object.entries({provider:'savedProvider',model:'savedModel',from:'savedFrom',to:'savedTo'})) $(id).value = filters[key];
  // Server validation is authoritative, including malformed dates and page bounds.
  const loaded = await loadSavedList(params.get('page') ?? 1, query, filters, false);
  if (!loaded) return;
  const requested = params.get('session');
  if (requested) await openSaved(requested);
  else {refresh();syncSavedURL();}
}
void restoreSavedView();
