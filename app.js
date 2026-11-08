(() => {
  const KEY = 'study-desk-v1';
  const ACTIVE_KEY = 'study-desk-active-session-v1';
  const today = new Date();
  const isoToday = localDate(today);
  const seed = { courses: [], sessions: [], plans: [], reflections: {}, weeklyTasks: {} };
  let data = loadData();
  const cloudConfig = window.STUDY_DESK_CONFIG || {};
  const cloudClient = window.supabase?.createClient && cloudConfig.supabaseUrl && cloudConfig.supabasePublishableKey
    ? window.supabase.createClient(cloudConfig.supabaseUrl, cloudConfig.supabasePublishableKey)
    : null;
  let cloudUser = null;
  let cloudBusy = false;
  let cloudDirty = false;
  let cloudPoll = null;
  let cloudSaveTimer = null;
  let activeSession = loadActiveSession();
  let recoveredSession = false;
  let ticker = null;
  let courseFilter = 'current';
  let planningWeek = weekStart(isoToday);

  function localDate(date) { const d = new Date(date); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }
  function weekStart(date) { const d=new Date(`${date}T12:00:00`);d.setDate(d.getDate()-((d.getDay()+6)%7));return localDate(d); }
  function loadData() { try { return { ...seed, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return structuredClone(seed); } }
  function loadActiveSession() { try { return JSON.parse(localStorage.getItem(ACTIVE_KEY) || 'null'); } catch { return null; } }
  function saveLocalOnly() { localStorage.setItem(KEY, JSON.stringify(data)); }
  function save() { saveLocalOnly(); if(cloudUser){cloudDirty=true;queueCloudSave();} }
  function mergeRows(remoteRows=[],localRows=[],keyOf=x=>x.id){const rows=new Map();for(const row of remoteRows)rows.set(keyOf(row),row);for(const row of localRows)rows.set(keyOf(row),{...rows.get(keyOf(row)),...row});return [...rows.values()];}
  function mergeCloudData(local,remote){
    const merged={...seed,...remote,...local};
    merged.courses=mergeRows(remote.courses||[],local.courses||[]);
    merged.sessions=mergeRows(remote.sessions||[],local.sessions||[]);
    merged.plans=mergeRows(remote.plans||[],local.plans||[],p=>`${p.date}:${p.courseId}`);
    merged.reflections={...(remote.reflections||{}),...(local.reflections||{})};
    merged.weeklyTasks={...(remote.weeklyTasks||{})};
    for(const [week,groups] of Object.entries(local.weeklyTasks||{})){
      merged.weeklyTasks[week]={...(merged.weeklyTasks[week]||{})};
      for(const [courseId,tasks] of Object.entries(groups||{}))merged.weeklyTasks[week][courseId]=mergeRows(merged.weeklyTasks[week][courseId]||[],tasks||[]);
    }
    return merged;
  }
  function setCloudMessage(message){const el=$('cloud-message');if(el)el.textContent=message;}
  function renderCloudState(){
    $('cloud-setup-help').hidden=!!cloudClient;
    $('cloud-auth-form').hidden=!cloudClient||!!cloudUser;
    $('cloud-signed-in').hidden=!cloudUser;
    $('cloud-account-btn').textContent=cloudUser?'Sync account':cloudClient?'Sign in to sync':'Set up sync';
    $('cloud-user-label').textContent=cloudUser?`Signed in as ${cloudUser.email||'your account'}`:'';
  }
  async function syncCloud(mode='pull'){
    if(!cloudClient||!cloudUser||cloudBusy)return;
    cloudBusy=true;
    try{
      const uid=cloudUser.id;const lastSyncKey=`${KEY}:last-sync:${uid}`;const ownerKey=`${KEY}:cloud-owner`;
      if(mode==='push'||cloudDirty){
        const {error}=await cloudClient.from('study_data').upsert({user_id:uid,data,updated_at:new Date().toISOString()},{onConflict:'user_id'});
        if(error)throw error;cloudDirty=false;localStorage.setItem(ownerKey,uid);localStorage.setItem(lastSyncKey,new Date().toISOString());
      }else{
        const {data:row,error}=await cloudClient.from('study_data').select('data').eq('user_id',uid).maybeSingle();
        if(error)throw error;
        if(mode==='initial'){
          const owner=localStorage.getItem(ownerKey);const previouslySynced=localStorage.getItem(lastSyncKey);
          if(owner&&owner!==uid){data=structuredClone(seed);saveLocalOnly();}
          const remoteData=row?.data||structuredClone(seed);
          if(!previouslySynced||owner!==uid)data=mergeCloudData(data,remoteData);else data=remoteData;
          saveLocalOnly();localStorage.setItem(ownerKey,uid);
          const {error:writeError}=await cloudClient.from('study_data').upsert({user_id:uid,data,updated_at:new Date().toISOString()},{onConflict:'user_id'});
          if(writeError)throw writeError;
          cloudDirty=false;localStorage.setItem(lastSyncKey,new Date().toISOString());render();
        }else if(row){
          // A local edit may have happened while the network request was in flight.
          // Keep that edit and let its queued save reach Supabase instead of replacing it.
          if(cloudDirty){queueCloudSave();return;}
          data=row.data;saveLocalOnly();localStorage.setItem(ownerKey,uid);localStorage.setItem(lastSyncKey,new Date().toISOString());render();
        }
        else{cloudDirty=true;queueCloudSave();}
      }
      setCloudMessage('Synced successfully.');
    }catch(error){setCloudMessage(`Sync issue: ${error.message||'check the Supabase setup'}`);}
    finally{cloudBusy=false;}
  }
  function queueCloudSave(){clearTimeout(cloudSaveTimer);cloudSaveTimer=setTimeout(()=>syncCloud('push'),600);}
  async function connectCloud(user){if(cloudUser?.id===user.id&&cloudPoll)return;cloudUser=user;renderCloudState();clearInterval(cloudPoll);cloudPoll=setInterval(()=>syncCloud('pull'),20000);await syncCloud('initial');}
  function disconnectCloud(){cloudUser=null;clearInterval(cloudPoll);clearTimeout(cloudSaveTimer);renderCloudState();}
  async function initializeCloud(){
    renderCloudState();
    if(!cloudClient)return;
    cloudClient.auth.onAuthStateChange((_event,session)=>setTimeout(()=>session?.user?connectCloud(session.user):disconnectCloud(),0));
    const {data:sessionData,error}=await cloudClient.auth.getSession();
    if(error)setCloudMessage(error.message);else if(sessionData.session?.user)await connectCloud(sessionData.session.user);
  }
  function esc(s='') { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  const $ = id => document.getElementById(id);
  const dateFmt = (d, opts={weekday:'short',month:'short',day:'numeric'}) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined,opts);
  const todayFmt = new Intl.DateTimeFormat(undefined, { weekday:'long', month:'long', day:'numeric' });
  $('today-label').textContent = todayFmt.format(today);
  $('journal-date').textContent = dateFmt(isoToday, {month:'short',day:'numeric'});

  function courseName(id) { return data.courses.find(c => c.id === id)?.name || 'Study session'; }
  function renderCourses() {
    const items = data.courses.filter(c => c.kind === courseFilter);
    $('course-nav-count').textContent = data.courses.filter(c=>c.kind==='current').length;
    for(const [key, kind] of [['current','current'],['later','later'],['skills','skills']]) {
      const count=data.courses.filter(c=>c.kind===kind).length;
      $(`${key}-tab-count`).textContent=count;
      if(key==='current') $('focus-count').textContent=count;
    }
    $('course-list').innerHTML = items.length ? items.map(c => {
      const sessions = data.sessions.filter(s=>s.courseId===c.id);
      const hours=sessions.reduce((n,s)=>n+(s.minutes||0),0)/60;
      const recent=[...sessions].sort((a,b)=>(b.date||'').localeCompare(a.date||'')||(b.createdAt||'').localeCompare(a.createdAt||''))[0];
      const meta=[c.milestone, c.target ? `By ${dateFmt(c.target,{month:'short',day:'numeric'})}`:'', recent?.activity ? `Last: ${recent.activity}` : sessions.length?`${sessions.length} ${sessions.length===1?'session':'sessions'} logged`:''].filter(Boolean).join(' · ') || 'Add a next milestone';
      const symbol=c.kind==='skills'?'✳':c.kind==='later'?'↗':'▤';
      return `<div class="course-row"><span class="course-symbol ${c.kind}">${symbol}</span><div class="course-info"><div class="course-title">${esc(c.name)}</div><div class="course-meta">${esc(meta)}</div></div><div class="course-progress"><span class="progress-number">${hours.toFixed(hours%1?1:0)}h</span><button class="course-menu" aria-label="Remove ${esc(c.name)}" data-remove-course="${c.id}">×</button></div></div>`;
    }).join('') : `<div class="empty-state"><strong>${courseFilter==='current'?'Your semester starts here':courseFilter==='later'?'Room for what comes next':'Every skill starts somewhere'}</strong>${courseFilter==='current'?'Add the courses you’re preparing to exam for.':'Add a goal whenever you’re ready.'}</div>`;
    document.querySelectorAll('.course-tab').forEach(t=>{const on=t.dataset.filter===courseFilter;t.classList.toggle('active',on);t.setAttribute('aria-selected',String(on));});
    const select=$('session-course');
    const options=data.courses.map(c=>`<option value="${c.id}">${esc(c.name)} · ${c.kind==='current'?'This semester':c.kind==='later'?'Coming up':'Skill'}</option>`).join('');
    select.innerHTML=options || '<option value="" disabled selected>Add a course or skill first</option>';
    $('manual-course').innerHTML=options || '<option value="" disabled selected>Add a course or skill first</option>';
    $('save-session').disabled=!data.courses.length;
  }
  function weekDays() { const d=new Date(); const day=(d.getDay()+6)%7; const mon=new Date(d); mon.setDate(d.getDate()-day); return Array.from({length:7},(_,i)=>{const x=new Date(mon);x.setDate(mon.getDate()+i);return localDate(x);}); }
  function renderWeek() {
    const days=weekDays(); const hrs=days.map(d=>data.sessions.filter(s=>s.date===d).reduce((n,s)=>n+s.minutes/60,0));
    const total=hrs.reduce((a,b)=>a+b,0); $('week-hours').textContent=total.toFixed(total%1?1:0); $('week-total-inline').textContent=`${total.toFixed(total%1?1:0)}h`;
    const count=data.sessions.filter(s=>days.includes(s.date)).length; $('week-sessions').textContent=count?`${count} focused ${count===1?'session':'sessions'}`:'No sessions yet';
    $('week-chart').innerHTML=days.map((d,i)=>{const h=hrs[i];const height=h?Math.max(7,Math.min(100,h/Math.max(2,...hrs)*100)):3;return `<div class="chart-day" data-day="${d}" role="button" tabindex="0" aria-label="${dateFmt(d)}: ${h.toFixed(1)} hours. Open daily breakdown"><div class="chart-bar ${h?'has-time':''} ${d===isoToday?'today':''}" style="height:${height}%"></div></div>`;}).join('');
    $('chart-labels').innerHTML=days.map(d=>`<span class="${d===isoToday?'is-today':''}">${new Date(`${d}T12:00:00`).toLocaleDateString(undefined,{weekday:'narrow'})}</span>`).join('');
    $('week-bars').innerHTML=hrs.map(h=>`<i style="height:${h?Math.max(4,Math.min(14,h/Math.max(2,...hrs)*14)):3}px"></i>`).join('');
  }
  function openCourseTimeBreakdown(day=null){
    const days=day?[day]:weekDays();
    const totals=new Map(data.courses.map(c=>[c.id,{course:c,minutes:0}]));
    for(const session of data.sessions){
      if(!days.includes(session.date))continue;
      const item=totals.get(session.courseId);
      if(item)item.minutes+=Number(session.minutes)||0;
      else totals.set(session.courseId,{course:{name:'Other study'},minutes:Number(session.minutes)||0});
    }
    const rows=[...totals.values()].sort((a,b)=>b.minutes-a.minutes||a.course.name.localeCompare(b.course.name));
    const total=rows.reduce((sum,row)=>sum+row.minutes,0);
    const formatDuration=minutes=>{const hours=Math.floor(minutes/60),rest=minutes%60;return hours?`${hours} h${rest?` ${rest} min`:''}`:`${rest} min`;};
    $('course-time-eyebrow').textContent=day?`${dateFmt(day,{weekday:'long',month:'short',day:'numeric'})} · STUDY TIME`:'THIS WEEK · STUDY TIME';
    $('course-time-title').textContent=day?'Daily time by course or goal':'Time by course or goal';
    $('course-time-total').textContent=day?`${formatDuration(total)} logged that day`:`${formatDuration(total)} total this week`;
    const max=Math.max(1,...rows.map(row=>row.minutes));
    $('course-time-list').innerHTML=rows.length?rows.map(({course,minutes})=>`<div class="course-time-row"><div class="course-time-label"><strong>${esc(course.name)}</strong><span>${formatDuration(minutes)}</span></div><div class="course-time-track"><i style="width:${minutes?Math.max(2,minutes/max*100):0}%"></i></div></div>`).join(''):'<div class="empty-state">No courses or goals yet.</div>';
    $('course-time-dialog').showModal();
  }
  function renderGates() {
    const courses=data.courses.filter(c=>c.kind==='current');
    $('gate-list').innerHTML=courses.length?courses.map(c=>`<div class="gate-row"><span class="gate-number">${String((c.gate||1)).padStart(2,'0')}</span><div class="gate-copy"><strong>${esc(c.name)}</strong><small>${['Getting started','Building understanding','Ready to apply'][(c.gate||1)-1]}</small></div><select class="gate-select" aria-label="Quality gate for ${esc(c.name)}" data-gate="${c.id}"><option value="1" ${c.gate===1?'selected':''}>01 · Starting</option><option value="2" ${c.gate===2?'selected':''}>02 · Building</option><option value="3" ${c.gate===3?'selected':''}>03 · Applying</option></select></div>`).join(''):`<div class="empty-state" style="padding:22px 10px">Add a this-semester course to set your learning gates.</div>`;
  }
  function renderToday() {
    const plan=data.plans.find(p=>p.date===isoToday);
    if(plan){$('session-focus-title').textContent=courseName(plan.courseId);$('session-focus-subtitle').textContent=plan.intention||'Planned focus for today';$('session-duration').textContent=`${plan.minutes} min planned`;}
    else {$('session-focus-title').textContent=activeSession?courseName(activeSession.courseId):'Nothing planned yet';$('session-focus-subtitle').textContent=activeSession?'Your focus session is underway':'Make space for a focused session';$('session-duration').textContent=activeSession?'In progress':'';}
    $('timer-main').innerHTML=activeSession?'Check out & save <span>✓</span>':'Start a session <span>→</span>';
    $('timer-state').textContent=activeSession?'FOCUSED TIME · CHECK OUT TO SAVE':recoveredSession?'PREVIOUS SESSION SAVED':'READY WHEN YOU ARE';
    if(activeSession) tick(); else {$('timer-clock').textContent='00:00';$('timer-ring').style.setProperty('--timer-angle','0deg');}
  }
  function renderReflection() {
    const r=data.reflections[isoToday]||{};
    document.querySelectorAll('.mood-option').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mood===r.mood)));
    // Do not replace a reflection draft while the user is typing in the field.
    if(document.activeElement!==$('journal-note'))$('journal-note').value=r.note||'';
    $('journal-saved').textContent=r.saved
      ? (cloudUser?'Saved for today · synced with your account':'Saved for today · stays on this device')
      : (cloudUser?'Draft saved automatically · syncing with your account':'Draft saved automatically on this device');
    const prev=Object.entries(data.reflections).filter(([d,r])=>d<isoToday&&(r.note||r.mood)).sort(([a],[b])=>b.localeCompare(a))[0];
    const el=$('previous-reflection');
    if(prev){el.classList.add('visible');el.innerHTML=`<strong>Last reflection · ${dateFmt(prev[0])}${prev[1].mood?` · ${moodName(prev[1].mood)}`:''}</strong><br>${esc(prev[1].note||'A check-in without a note.')}`;} else {el.classList.remove('visible');el.textContent='';}
  }
  function moodName(m){return {low:'Heavy',okay:'Okay',good:'Good',great:'Great'}[m]||'';}
  function renderStreak(){const days=new Set(data.sessions.map(s=>s.date));let n=0;let d=new Date();if(!days.has(isoToday))d.setDate(d.getDate()-1);while(days.has(localDate(d))){n++;d.setDate(d.getDate()-1);} $('streak-count').textContent=n;$('streak-message').textContent=n?`${n===1?'One day':'You showed up '+n+' days'} in a row`:'Start with one focused session';}
  function renderWeeklyTasks(){
    const weekEnd=new Date(`${planningWeek}T12:00:00`);weekEnd.setDate(weekEnd.getDate()+6);
    const startText=new Date(`${planningWeek}T12:00:00`).toLocaleDateString(undefined,{month:'short',day:'numeric'});
    const endText=weekEnd.toLocaleDateString(undefined,{month:'short',day:'numeric'});
    $('planning-week-label').textContent=`${startText} – ${endText}`;
    $('current-week').hidden=planningWeek===weekStart(isoToday);
    const courses=data.courses;
    if(!courses.length){$('weekly-groups').innerHTML='<div class="empty-state"><strong>Add a course or goal to start planning</strong>Your weekly tasks will be organized under each one.</div>';return;}
    const tasks=data.weeklyTasks[planningWeek]||{};
    $('weekly-groups').innerHTML=courses.map(c=>{
      const rows=tasks[c.id]||[];
      return `<section class="weekly-course"><div class="weekly-course-heading"><span class="course-symbol ${c.kind}">${c.kind==='skills'?'✳':c.kind==='later'?'↗':'▤'}</span><div><strong>${esc(c.name)}</strong><small>${c.kind==='current'?'This semester':c.kind==='later'?'Coming up':'Skill to build'}</small></div></div><ul class="task-list">${rows.length?rows.map(t=>`<li class="task-row ${t.done?'is-done':''}"><label><input type="checkbox" data-task-toggle="${t.id}" data-course-id="${c.id}" ${t.done?'checked':''}><span>${esc(t.text)}</span></label>${t.day!==''&&t.day!=null?`<small>${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][Number(t.day)]}</small>`:''}<button class="task-delete" data-task-delete="${t.id}" data-course-id="${c.id}" aria-label="Delete task">×</button></li>`).join(''):'<li class="task-empty">No tasks planned yet</li>'}</ul><form class="add-task-form" data-add-task="${c.id}"><input name="task" type="text" maxlength="160" placeholder="Add a task…" aria-label="Add a task for ${esc(c.name)}" required><select name="day" aria-label="Task day"><option value="">No day</option>${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((day,i)=>`<option value="${i}">${day}</option>`).join('')}</select><button type="submit" aria-label="Add task">＋</button></form></section>`;
    }).join('');
  }
  function render(){renderCourses();renderWeek();renderGates();renderToday();renderReflection();renderStreak();renderWeeklyTasks();}
  function tick(){if(!activeSession)return;const now=Date.now();const seconds=Math.floor((now-activeSession.startedAt)/1000);const mins=Math.floor(seconds/60);const sec=seconds%60;$('timer-clock').textContent=`${String(mins).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;$('timer-ring').style.setProperty('--timer-angle',`${Math.min(360,seconds/Math.max(1,activeSession.plannedMinutes*60)*360)}deg`);if(now-(activeSession.lastHeartbeatAt||activeSession.startedAt)>=10000){activeSession.lastHeartbeatAt=now;saveActiveSession();}}
  function saveActiveSession(){if(activeSession)localStorage.setItem(ACTIVE_KEY,JSON.stringify(activeSession));}
  function finishActiveSession(endedAt=Date.now(), repaint=true){if(!activeSession)return;clearInterval(ticker);const session=activeSession;const elapsed=Math.max(1,Math.round((endedAt-session.startedAt)/60000));if(!data.sessions.some(s=>s.id===session.id)){data.sessions.push({id:session.id,courseId:session.courseId,date:session.date||localDate(new Date(session.startedAt)),minutes:elapsed,createdAt:new Date(endedAt).toISOString()});}data.plans=data.plans.filter(p=>!(p.date===(session.date||isoToday)&&p.courseId===session.courseId));activeSession=null;localStorage.removeItem(ACTIVE_KEY);save();if(repaint)render();}
  function startSession(){if(activeSession){checkout();return;}let plan=data.plans.find(p=>p.date===isoToday);if(!data.courses.length){$('course-dialog').showModal();return;}if(!plan){$('session-dialog').showModal();return;}const now=Date.now();activeSession={id:crypto.randomUUID(),courseId:plan.courseId,date:isoToday,startedAt:now,lastHeartbeatAt:now,plannedMinutes:plan.minutes};saveActiveSession();ticker=setInterval(tick,1000);recoveredSession=false;renderToday();}
  function checkout(){finishActiveSession(Date.now());}
  window.addEventListener('pagehide',()=>finishActiveSession(Date.now(),false));
  function showSessionDialog(){if(!data.courses.length){$('course-dialog').showModal();return;}$('session-date').value=isoToday;$('session-dialog').showModal();}
  $('checkin-btn').addEventListener('click',startSession);$('timer-main').addEventListener('click',startSession);$('quick-plan-btn').addEventListener('click',showSessionDialog);$('plan-session-btn').addEventListener('click',showSessionDialog);
  $('week-chart').addEventListener('click',e=>{const bar=e.target.closest('[data-day]');openCourseTimeBreakdown(bar?.dataset.day||null);});
  $('week-chart').addEventListener('keydown',e=>{if(e.key!=='Enter'&&e.key!==' ')return;const bar=e.target.closest('[data-day]');if(!bar)return;e.preventDefault();openCourseTimeBreakdown(bar.dataset.day);});
  $('cloud-account-btn').addEventListener('click',()=>{$('cloud-dialog-title').textContent=cloudUser?'Study sync':cloudClient?'Sign in to sync':'Set up study sync';setCloudMessage('');$('cloud-dialog').showModal();});
  $('cloud-auth-form').addEventListener('submit',async e=>{e.preventDefault();if(!cloudClient)return;setCloudMessage('Signing in…');const {error}=await cloudClient.auth.signInWithPassword({email:$('cloud-email').value.trim(),password:$('cloud-password').value});setCloudMessage(error?error.message:'Signed in. Loading your study data…');});
  $('cloud-signup').addEventListener('click',async()=>{if(!cloudClient||!$('cloud-auth-form').reportValidity())return;setCloudMessage('Creating your account…');const {data:result,error}=await cloudClient.auth.signUp({email:$('cloud-email').value.trim(),password:$('cloud-password').value});if(error)setCloudMessage(error.message);else if(!result.session)setCloudMessage('Check your email for the confirmation link, then sign in here.');else setCloudMessage('Account created. Syncing your study data…');});
  $('cloud-signout').addEventListener('click',async()=>{if(!cloudClient)return;if(cloudDirty){clearTimeout(cloudSaveTimer);await syncCloud('push');if(cloudDirty)return;}await cloudClient.auth.signOut();});
  $('manual-log-btn').addEventListener('click',()=>{if(activeSession){alert('Check out your current timed session before adding a manual one.');return;}if(!data.courses.length){$('course-dialog').showModal();return;}$('manual-form').reset();$('manual-date').max=isoToday;$('manual-date').value=isoToday;$('manual-dialog').showModal();});
  document.querySelectorAll('.course-tab').forEach(t=>t.addEventListener('click',()=>{courseFilter=t.dataset.filter;renderCourses();}));
  $('add-course-btn').addEventListener('click',()=>{$('course-form').reset();$('course-dialog-title').textContent='Add a course or goal';$('course-dialog').showModal();});
  $('course-form').addEventListener('submit',e=>{if(e.submitter?.value==='cancel')return;e.preventDefault();const c={id:crypto.randomUUID(),name:$('course-name').value.trim(),kind:$('course-kind').value,target:$('course-date').value,milestone:$('course-note').value.trim(),gate:1};if(!c.name)return;data.courses.push(c);save();$('course-dialog').close();courseFilter=c.kind;render();});
  $('course-list').addEventListener('click',e=>{const b=e.target.closest('[data-remove-course]');if(!b)return;const id=b.dataset.removeCourse;if(!confirm(`Remove “${courseName(id)}” and its planned sessions? Logged study sessions will be kept.`))return;data.courses=data.courses.filter(c=>c.id!==id);data.plans=data.plans.filter(p=>p.courseId!==id);save();render();});
  $('session-form').addEventListener('submit',e=>{if(e.submitter?.value==='cancel')return;e.preventDefault();const p={id:crypto.randomUUID(),courseId:$('session-course').value,date:$('session-date').value,minutes:Number($('session-minutes').value),intention:$('session-intention').value.trim()};if(!p.courseId||!p.date)return;data.plans=data.plans.filter(x=>!(x.date===p.date&&x.courseId===p.courseId));data.plans.push(p);save();$('session-dialog').close();renderToday();});
  $('manual-form').addEventListener('submit',e=>{if(e.submitter?.value==='cancel')return;e.preventDefault();const entry={id:crypto.randomUUID(),courseId:$('manual-course').value,date:$('manual-date').value,minutes:Number($('manual-duration').value),activity:$('manual-activity').value.trim(),source:'manual',createdAt:new Date().toISOString()};if(!entry.courseId||!entry.date||!entry.minutes)return;data.sessions.push(entry);save();$('manual-dialog').close();render();});
  $('gate-list').addEventListener('change',e=>{const id=e.target.dataset.gate;if(!id)return;const c=data.courses.find(c=>c.id===id);if(c)c.gate=Number(e.target.value);save();renderGates();});
  $('previous-week').addEventListener('click',()=>{const d=new Date(`${planningWeek}T12:00:00`);d.setDate(d.getDate()-7);planningWeek=localDate(d);renderWeeklyTasks();});
  $('next-week').addEventListener('click',()=>{const d=new Date(`${planningWeek}T12:00:00`);d.setDate(d.getDate()+7);planningWeek=localDate(d);renderWeeklyTasks();});
  $('current-week').addEventListener('click',()=>{planningWeek=weekStart(isoToday);renderWeeklyTasks();});
  $('weekly-groups').addEventListener('submit',e=>{const form=e.target.closest('[data-add-task]');if(!form)return;e.preventDefault();const id=form.dataset.addTask;const text=new FormData(form).get('task')?.toString().trim();if(!text)return;data.weeklyTasks[planningWeek]??={};data.weeklyTasks[planningWeek][id]??=[];data.weeklyTasks[planningWeek][id].push({id:crypto.randomUUID(),text,day:form.elements.day.value,done:false});save();renderWeeklyTasks();});
  $('weekly-groups').addEventListener('change',e=>{const id=e.target.dataset.taskToggle;if(!id)return;const rows=data.weeklyTasks[planningWeek]?.[e.target.dataset.courseId]||[];const task=rows.find(t=>t.id===id);if(task)task.done=e.target.checked;save();renderWeeklyTasks();});
  $('weekly-groups').addEventListener('click',e=>{const b=e.target.closest('[data-task-delete]');if(!b)return;const rows=data.weeklyTasks[planningWeek]?.[b.dataset.courseId]||[];data.weeklyTasks[planningWeek][b.dataset.courseId]=rows.filter(t=>t.id!==b.dataset.taskDelete);save();renderWeeklyTasks();});
  document.querySelectorAll('.mood-option').forEach(b=>b.addEventListener('click',()=>{data.reflections[isoToday]={...data.reflections[isoToday],mood:b.dataset.mood,saved:false};save();renderReflection();}));
  $('journal-note').addEventListener('input',()=>{data.reflections[isoToday]={...data.reflections[isoToday],note:$('journal-note').value,saved:false};saveLocalOnly();if(cloudUser){cloudDirty=true;queueCloudSave();}renderReflection();});
  $('save-journal').addEventListener('click',()=>{data.reflections[isoToday]={...data.reflections[isoToday],note:$('journal-note').value.trim(),saved:true};save();renderReflection();});
  $('gate-guide-btn').addEventListener('click',()=>$('gate-dialog').showModal());document.querySelectorAll('.dialog-close,.dialog-done').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
  $('export-btn').addEventListener('click',exportData);$('manage-data').addEventListener('click',()=>{const action=prompt('Your study data stays in this browser. Type “export” to save a backup or “import” to restore one.');if(action?.toLowerCase()==='export')exportData();if(action?.toLowerCase()==='import')$('import-file').click();});
  function exportData(){const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`study-desk-${isoToday}.json`;a.click();URL.revokeObjectURL(a.href);}
  $('import-file').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{const parsed=JSON.parse(await file.text());if(!Array.isArray(parsed.courses)||!Array.isArray(parsed.sessions))throw new Error();data={...seed,...parsed};save();render();alert('Study data restored.');}catch{alert('That file does not look like a Study Desk backup.');}e.target.value='';});
  if(activeSession){recoveredSession=true;finishActiveSession(Number(activeSession.lastHeartbeatAt)||Number(activeSession.startedAt)||Date.now(),false);}
  render();
  initializeCloud();
})();
