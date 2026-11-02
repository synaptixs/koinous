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
let sessionId = null, events = null, ready = false, busy = false, inferenceEnabled = false;
const rows = [];
let historyLoading = false, historyPage = 1, historyQuery = '', historyPrevious = false, historyNext = false;
let historyFilters = {provider:'', model:'', from:'', to:''};
function selectedHistoryFilters() { return {provider:$('savedProvider').value, model:$('savedModel').value.trim(), from:$('savedFrom').value, to:$('savedTo').value}; }
function selection() {
  const selected = rows.filter(row => row.toggle.checked);
  return {providers: selected.map(row => row.id), models: Object.fromEntries(selected.map(row => [row.id, row.model.value.trim()]))};
}
function refresh() {
  const chosen = selection();
  const invalidModel = Object.values(chosen.models).some(value => value.length > 128 || (value && !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(value)));
  const error = !ready ? 'Provider configuration unavailable.' : chosen.providers.length < 2 ? 'Choose at least two providers.' : invalidModel ? 'Enter a valid model ID (up to 128 characters).' : '';
  $('selectionError').textContent = error || (!inferenceEnabled ? 'Inference is disabled. Saved discussions can still be reviewed.' : '');
  $('run').disabled = busy || !!error || !inferenceEnabled;
  $('openSaved').disabled = busy || historyLoading || !$('savedSessions').value;
  for (const id of ['savedProvider','savedModel','savedFrom','savedTo','savedSessions','refreshSaved','savedSearch','searchSaved','clearSaved']) $(id).disabled = busy || historyLoading;
  $('previousSaved').disabled = busy || historyLoading || !historyPrevious;
  $('nextSaved').disabled = busy || historyLoading || !historyNext;
  $('rounds').disabled = busy;
  for(const id of ['researchMode','researchQuery']) $(id).disabled = busy;
  for (const row of rows) { row.toggle.disabled = busy; row.model.disabled = busy || !row.toggle.checked; }
  $('plannedCalls').textContent = chosen.providers.length * Number($('rounds').value);
  if (!sessionId) $('maxCalls').textContent = $('plannedCalls').textContent;
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
  heading.textContent=invalid?'Validation failed — excluded from structured coverage and agreement':validation?.status==='valid'?'Schema checks passed — not a fact check or agreement':'Schema validation unavailable — readable formatting does not imply validity';
  note.append(heading);
  if(invalid){
    const list=document.createElement('ul');
    for(const issue of validation.issues||[]){const item=document.createElement('li');item.textContent=issue.message;list.append(item);}
    note.append(list);
    const help=document.createElement('p');help.textContent='Original response preserved. Shorten the named fields to the stated limits in a future response. No automatic repair or retry was made. Character counts use UTF-16 code units.';note.append(help);
  }
  return note;
}
// Presentation only: render declared fields without assessing agreement or factual support.
// The server's outcome and coverage remain authoritative; the exact response stays available.
function appendResponse(entry) {
  const title='Round '+entry.round+' · '+entry.agent;
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
  if(!review){section('Declared direction',data.direction);section('Why this approach',data.rationale);}
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
const configurationReady = fetch('/api/health').then(async response => {
  if (!response.ok) throw Error('Configuration unavailable');
  const health = await response.json();
  inferenceEnabled = health.mode === 'mock' || health.inferenceEnabled === true;
  $('providers').textContent = health.mode === 'mock' ? 'Mock mode · no model calls' : 'Subscription login · no API-key fallback';
  for (const provider of health.availableProviders) {
    const card = document.createElement('div'); card.className = 'choice';
    const label = document.createElement('label');
    const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.checked = health.agents.includes(provider.id); toggle.id = 'provider-' + provider.id;
    label.append(toggle, document.createTextNode(provider.label));
    const modelLabel = document.createElement('label'); modelLabel.textContent = provider.label + ' model ID'; modelLabel.htmlFor = 'model-' + provider.id;
    const model = document.createElement('input'); model.type = 'text'; model.id = modelLabel.htmlFor; model.maxLength = 128; model.placeholder = provider.defaultModel || 'SDK default'; model.autocomplete = 'off';
    const note = document.createElement('small'); note.textContent = 'Default: ' + (provider.defaultModel || 'SDK default') + (provider.id === 'grok' ? ' · Build runtime must be configured' : '');
    card.append(label, modelLabel, model, note); $('providerChoices').append(card);
    rows.push({id: provider.id, toggle, model}); toggle.onchange = refresh; model.oninput = refresh;
  }
  ready = true; refresh();
  if (!inferenceEnabled) $('selectionError').textContent = 'Inference is disabled. Saved discussions can still be reviewed.';
}).catch(() => { $('providers').textContent = 'Provider configuration unavailable'; refresh(); });
$('rounds').onchange = refresh;
function finish(status) {
  busy = false; $('status').textContent = status; $('send').disabled = true; $('cancel').disabled = true;
  if (events) events.close(); refresh();
}
$('run').onclick = async () => {
  if (busy || !refresh() || !inferenceEnabled) return;
  const request = {prompt: $('question').value, context: $('context').value, grounding: 'none', maxRounds: Number($('rounds').value), selection: selection()};
  if($('researchMode').value==='wikipedia')request.research={mode:'wikipedia',query:$('researchQuery').value};
  sessionId = null; syncSavedURL(); busy = true; $('reviewNotice').textContent = ''; refresh();
  if (events) events.close();
  $('outcome').textContent = 'Available after the discussion.'; $('evidence').textContent = 'Idea and optional context';
  $('feed').replaceChildren(); $('status').textContent = 'Creating'; $('calls').textContent = '0'; $('cost').textContent = 'Unknown'; $('report').style.display = 'none';
  try {
    const response = await fetch('/api/sessions', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(request)});
    const data = await response.json(); if (!response.ok) throw Error(data.error);
    sessionId = data.id; $('send').disabled = false; $('cancel').disabled = false;
    events = new EventSource('/api/sessions/' + sessionId + '/events');
    events.onmessage = event => {
      const x = JSON.parse(event.data);
      switch (x.type) {
        case 'participants.configured': $('maxCalls').textContent = x.maxCalls; append('Selected providers', x.agents.map(id => id + ': ' + (x.selection?.models[id] || 'SDK default')).join('\n')); break;
        case 'runtime.preparing': $('status').textContent = 'Preparing runtime'; append('Runtime · ' + x.agent, 'Provisioning and verifying the isolated runtime before model calls'); break;
        case 'runtime.ready': append('Runtime · ' + x.agent, 'Sandbox and subscription authentication verified'); break;
        case 'runtime.cleaning': $('status').textContent = 'Cleaning up'; append('Runtime · ' + x.agent, 'Cleaning credentials and removing the disposable runtime'); break;
        case 'runtime.cleaned': append('Runtime · ' + x.agent, 'Runtime cleanup completed'); break;
        case 'research.started': $('status').textContent='Researching'; append('Research query',x.query); break;
        case 'research.completed': $('evidence').textContent=x.sources.length+' Wikipedia background sources'; append('Retrieved sources',x.sources.map(s=>s.id+' · '+s.uri+'\n'+s.text).join('\n\n')); break;
        case 'workflow.assessed': showWorkflow(x.workflow); break;
        case 'grounding.skipped': $('evidence').textContent = 'Idea and optional context'; break;
        case 'discussion.assessed': showOutcome(x.outcome); break;
        case 'position.invalid': append('Final position unavailable · ' + x.agent, x.reason); break;
        case 'grounding.pinned': $('evidence').textContent = x.snapshotId; break;
        case 'round.started': $('status').textContent = 'Running'; append('Round ' + x.round, 'Providers are running in parallel'); break;
        case 'agent.started': $('calls').textContent = x.call; break;
        case 'agent.completed': appendResponse(x); $('cost').textContent = '$' + Number(x.spendKnownUSD).toFixed(4) + (x.spendIncomplete ? ' (partial; unknown costs)' : ' (accounting value)'); break;
        case 'agent.error': append('Provider error · ' + x.agent, x.error); break;
        case 'human.intervention': append('Human intervention', x.message); break;
        case 'session.error': append('Error', x.error); break;
        case 'session.finished': finish(x.status); $('cost').textContent = '$' + Number(x.spendKnownUSD).toFixed(4) + (x.spendIncomplete ? ' (partial; unknown costs)' : ' (accounting value)'); $('report').href = '/api/sessions/' + sessionId + '/report'; $('report').style.display = 'inline'; syncSavedURL(); break;
      }
    };
    events.onerror = () => { append('Connection lost', 'The discussion may still be running. Reloading or starting again does not cancel it.'); events.close(); $('status').textContent = 'Connection lost'; };
  } catch (error) { append('Error', error.message); finish('Failed to start'); }
};
$('send').onclick = async () => {
  const message = $('intervene').value.trim(); if (!sessionId || !message) return;
  const response = await fetch('/api/sessions/' + sessionId + '/interventions', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({message})});
  if (response.ok) $('intervene').value = ''; else append('Error', (await response.json()).error);
};
$('cancel').onclick = async () => { if (sessionId) await fetch('/api/sessions/' + sessionId + '/cancel', {method: 'POST'}); };

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
  for(const p of o.positions){const card=viewSection(p.agent+' · Why this approach',readableText(p.position.rationale));
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
  for (const key of ['q','page','provider','model','from','to','session']) params.delete(key);
  if (historyQuery) params.set('q', historyQuery);
  params.set('page', String(historyPage));
  for (const [key,value] of Object.entries(historyFilters)) if (value) params.set(key,value);
  if (sessionId) params.set('session',sessionId);
  history.replaceState(null, '', location.pathname + '?' + params.toString() + location.hash);
}

async function loadSavedList(page = historyPage, query = historyQuery, filters = historyFilters, updateURL = true) {
  if (historyLoading || busy) return;
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
    $('savedSessions').value = data.sessions.some(s => s.id === previous) ? previous : '';
    const first = data.total ? (data.page - 1) * data.pageSize + 1 : 0;
    const last = data.total ? first + data.sessions.length - 1 : 0;
    $('savedStatus').textContent = 'Showing ' + first + '–' + last + ' of ' + data.total + ' matching discussions (' + data.discoveredTotal + ' readable discovered).' + (data.scanTruncated ? ' Discovery is partial; unscanned folders may contain more matches.' : '') + ' ' + data.unavailable + ' incomplete, invalid, or ambiguous records unavailable.';
    if (updateURL) syncSavedURL();
    return true;
  } catch (error) {
    $('savedStatus').textContent = error.message;
    $('savedSessions').replaceChildren(); $('savedSessions').value = '';
    historyPrevious = false; historyNext = false; $('savedPage').textContent = 'Page unavailable';
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
    if (events) events.close();
    sessionId = s.id;
    $('feed').replaceChildren();
    $('question').value = s.prompt; $('context').value = s.context || '';
    $('rounds').value = String(s.maxRounds);
    $('researchMode').value=s.workflow?.research.status==='completed'?'wikipedia':'none';
    $('researchQuery').value=s.workflow?.research.query||'';
    if (s.selection) for (const row of rows) { row.toggle.checked = s.selection.providers.includes(row.id); row.model.value = s.selection.models[row.id] || ''; }
    $('calls').textContent = s.calls; $('maxCalls').textContent = s.maxCalls ?? 'Unknown';
    $('cost').textContent = '$' + Number(s.spendKnownUSD).toFixed(4) + (s.spendIncomplete ? ' (partial; unknown costs)' : ' (accounting value)');
    $('evidence').textContent = s.evidence ? s.evidence.id : 'Idea and optional context';
    if (s.selection) append('Selected providers', s.selection.providers.map(id => id + ': ' + (s.selection.models[id] || 'SDK default')).join('\n'));
    for (let round=1; round<=s.maxRounds; round++) {
      append('Round ' + round, 'Saved responses');
      for (const entry of s.entries.filter(e => e.round === round)) appendResponse(entry);
    }
    for (const failure of s.failures || []) append('Recorded failure · ' + (failure.agent || 'session'), failure.error || failure.reason || failure.type);
    if(s.workflow)showWorkflow(s.workflow);
    if (s.outcome) showOutcome(s.outcome); else $('outcome').textContent = 'No agreement assessment was recorded for this older discussion. Review the original transcript and report.';
    $('reviewNotice').textContent = 'Reviewing saved discussion ' + s.id + ' · read-only. No model calls were made to open it.';
    $('report').href = '/api/sessions/' + sessionId + '/report'; $('report').style.display = 'inline';
    finish(s.status);
    syncSavedURL();
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
  const filters = Object.fromEntries(['provider','model','from','to'].map(key => [key,params.get(key)||'']));
  const query = params.get('q') || '';
  $('savedSearch').value = query;
  for (const [key,id] of Object.entries({provider:'savedProvider',model:'savedModel',from:'savedFrom',to:'savedTo'})) $(id).value = filters[key];
  // Server validation is authoritative, including malformed dates and page bounds.
  const loaded = await loadSavedList(params.get('page') ?? 1, query, filters, false);
  if (!loaded) return;
  const requested = params.get('session');
  if (requested) await openSaved(requested);
  else syncSavedURL();
}
void restoreSavedView();
