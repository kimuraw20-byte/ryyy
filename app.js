// ======== إعداد التخزين ========
const LS_KEY = 'munazzam_state_full_v3'; // subjects + notes فقط
const DB_NAME = 'munazzam_db_full_v3';
const DB_VERSION = 1; // objectStore: items(id, subjectId, kind, name/title, type, blob, createdAt)

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

const state = { 
  subjects: [], 
  selectedSubjectId: null, 
  selecting: false, 
  selectedIds: new Set(),
  searchQuery: ''
};

function load(){
  try{ 
    const raw = localStorage.getItem(LS_KEY); 
    if(raw) Object.assign(state, JSON.parse(raw)); 
  }catch(e){}
}
function save(){
  localStorage.setItem(LS_KEY, JSON.stringify({
    subjects: state.subjects, 
    selectedSubjectId: state.selectedSubjectId
  }));
}

// IndexedDB helpers
function openDB(){
  return new Promise((resolve,reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if(!db.objectStoreNames.contains('items')){
        const store = db.createObjectStore('items', {keyPath:'id'});
        store.createIndex('by_subject_kind', ['subjectId','kind']);
        store.createIndex('by_subject', ['subjectId']);
      }
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}
async function idbAdd(item){
  const db = await openDB();
  await new Promise((res,rej)=>{
    const tx = db.transaction('items','readwrite');
    tx.objectStore('items').put(item);
    tx.oncomplete=()=>res();
    tx.onerror=()=>rej(tx.error);
  });
}
async function idbGetBySubjectKind(subjectId, kind){
  const db = await openDB();
  return await new Promise((res,rej)=>{
    const tx = db.transaction('items');
    const idx = tx.objectStore('items').index('by_subject_kind');
    const range = IDBKeyRange.only([subjectId, kind]);
    const out = [];
    idx.openCursor(range).onsuccess = e => {
      const cur = e.target.result;
      if(cur){ out.push(cur.value); cur.continue(); } else res(out.sort((a,b)=>b.createdAt-a.createdAt));
    };
    tx.onerror=()=>rej(tx.error);
  });
}
async function idbDeleteMany(ids){
  const db = await openDB();
  await new Promise((res,rej)=>{
    const tx = db.transaction('items','readwrite');
    const st = tx.objectStore('items');
    ids.forEach(id => st.delete(id));
    tx.oncomplete=()=>res();
    tx.onerror=()=>rej(tx.error);
  });
}
async function idbDeleteBySubject(subjectId){
  const db = await openDB();
  await new Promise((res,rej)=>{
    const tx = db.transaction('items','readwrite');
    const st = tx.objectStore('items');
    const idx = st.index('by_subject');
    const range = IDBKeyRange.only([subjectId]);
    idx.openCursor(range).onsuccess = e=>{
      const cur = e.target.result;
      if(cur){ st.delete(cur.primaryKey); cur.continue(); }
    };
    tx.oncomplete=()=>res();
    tx.onerror=()=>rej(tx.error);
  });
}

// ======== أدوات عامة ========
function hexToRGBA(hex,a=1){
  const m=/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)||[];
  const r=parseInt(m[1]||'7E',16),g=parseInt(m[2]||'57',16),b=parseInt(m[3]||'C2',16);
  return `rgba(${r},${g},${b},${a})`;
}
function uid(){ return Math.random().toString(36).slice(2,10); }
function escapeHtml(str){ return (str||'').replace(/[&<>"']/g, s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s])); }
function escapeAttr(str){ return (str||'').replace(/"/g,'&quot;'); }

// ======== البحث ========
$('#searchInput').addEventListener('input', (e) => {
  state.searchQuery = e.target.value.trim().toLowerCase();
  const filtered = state.searchQuery 
    ? state.subjects.filter(s => 
        s.name.toLowerCase().includes(state.searchQuery) || 
        s.mood.includes(state.searchQuery))
    : state.subjects;
  
  renderHome(filtered);
  
  // إظهار/إخفاء زر مسح البحث
  $('#clearSearch').style.display = state.searchQuery ? 'flex' : 'none';
});

$('#clearSearch').addEventListener('click', () => {
  state.searchQuery = '';
  $('#searchInput').value = '';
  $('#clearSearch').style.display = 'none';
  renderHome();
});

// ======== النسخ الاحتياطي والاستعادة ========
$('#exportBtn').addEventListener('click', exportData);
$('#importBtn').addEventListener('click', () => $('#importInput').click());
$('#importInput').addEventListener('change', async (e) => {
  if (e.target.files.length) {
    await importData(e.target.files[0]);
    e.target.value = ''; // reset input
  }
});

function exportData() {
  const data = {
    subjects: state.subjects,
    version: DB_VERSION,
    exportedAt: new Date().toISOString()
  };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `munazzam-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function importData(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    
    // التحقق من صحة البيانات قبل الاستيراد
    if (data.subjects && Array.isArray(data.subjects)) {
      if (confirm('هل تريد استبدال البيانات الحالية؟ سيتم فقدان البيانات غير المحفوظة.')) {
        state.subjects = data.subjects;
        save();
        renderHome();
        alert('تم استيراد البيانات بنجاح!');
      }
    } else {
      alert('ملف غير صالح. يرجى اختيار ملف نسخ احتياطي صالح.');
    }
  } catch (error) {
    alert('حدث خطأ أثناء استيراد البيانات: ' + error.message);
  }
}

// ======== واجهة رئيسية ========
function renderHome(list = state.subjects){
  $('#home').classList.add('active');
  $('#subject').classList.remove('active');
  const grid = $('#subjectsGrid'); grid.innerHTML='';
  
  // تطبيق البحث إذا كان موجودًا
  const filteredList = state.searchQuery 
    ? list.filter(s => 
        s.name.toLowerCase().includes(state.searchQuery) || 
        s.mood.includes(state.searchQuery))
    : list;
  
  if(filteredList.length===0){
    grid.innerHTML=`<div class="empty">${state.searchQuery?'لم يتم العثور على نتائج':'لا توجد مواد'}</div>`;
    return;
  }
  
  filteredList.forEach(subj=>{
    const card = document.createElement('div'); card.className='card'; 
    card.style.background = hexToRGBA(subj.color);
    card.innerHTML = `
      <span class="emoji">${escapeHtml(subj.icon)}</span>
      <h3>${escapeHtml(subj.name)}</h3>
      <span class="mood">${escapeHtml(subj.mood)}</span>
    `;
    card.addEventListener('click',()=>openSubject(subj.id));
    grid.appendChild(card);
  });
}

// ======== شاشة المادة ========
async function openSubject(id){
  state.selectedSubjectId = id;
  save();
  $('#home').classList.remove('active');
  $('#subject').classList.add('active');
  const subj = state.subjects.find(s=>s.id===id);
  if(!subj) return;
  $('#subjectIcon').textContent = subj.icon;
  $('#subjectName').textContent = subj.name;
  $('#subjectMood').textContent = subj.mood;
  $('#editSubjectBtn').onclick = () => openEditSubjectDialog(subj);
  renderTab('notes');
}

function renderTab(kind){
  $$('.tab').forEach(t=>t.classList.remove('active'));
  $(`.tab[data-tab="${kind}"]`).classList.add('active');
  $$('.tab-body').forEach(b=>b.classList.remove('active'));
  $(`#tab-${kind}`).classList.add('active');
  loadItems(kind);
}

async function loadItems(kind){
  const listEl = $(`#${kind}List`);
  const emptyEl = $(`[data-empty="${kind}"]`);
  const items = await idbGetBySubjectKind(state.selectedSubjectId, kind);
  
  if(items.length===0){
    listEl.innerHTML='';
    emptyEl.style.display='block';
    return;
  }
  emptyEl.style.display='none';
  
  if(kind==='notes'){
    listEl.innerHTML = items.map(item=>`
      <li class="note selectable" data-id="${escapeAttr(item.id)}">
        <div>${escapeHtml(item.text).replace(/\n/g,'<br>')}</div>
      </li>
    `).join('');
  } else if(kind==='files'){
    listEl.innerHTML = items.map(item=>`
      <div class="file-card selectable" data-id="${escapeAttr(item.id)}">
        <div class="file-icon">📄</div>
        <div class="file-title">${escapeHtml(item.title||item.name)}</div>
        <div class="file-ext">${escapeHtml(item.type||'file')}</div>
      </div>
    `).join('');
  } else if(kind==='images'){
    listEl.innerHTML = items.map(item=>`
      <div class="img-card selectable" data-id="${escapeAttr(item.id)}">
        <img src="${URL.createObjectURL(item.blob)}" alt="${escapeAttr(item.name)}">
      </div>
    `).join('');
  } else if(kind==='audio'){
    listEl.innerHTML = items.map(item=>`
      <div class="audio-card selectable" data-id="${escapeAttr(item.id)}">
        <audio controls src="${URL.createObjectURL(item.blob)}"></audio>
        <div class="file-title">${escapeHtml(item.name)}</div>
      </div>
    `).join('');
  }
  
  // إضافة أحداث النقر لعرض الصور بالحجم الكامل
  if(kind==='images'){
    $$('#imagesList .img-card img').forEach(img=>{
      img.addEventListener('click', e=>{
        $('#modalImage').src = e.target.src;
        $('#imageModal').classList.add('show');
      });
    });
  }
  
  // إضافة أحداث التحديد
  $$('.selectable').forEach(el=>{
    el.addEventListener('click', e=>{
      if(!state.selecting) return;
      const id = el.dataset.id;
      if(state.selectedIds.has(id)){
        state.selectedIds.delete(id);
        el.classList.remove('selected');
      } else {
        state.selectedIds.add(id);
        el.classList.add('selected');
      }
      updateSelectedCount();
    });
  });
}

// ======== التبويبات ========
$$('.tab').forEach(tab=>{
  tab.addEventListener('click',()=>{
    const kind = tab.dataset.tab;
    renderTab(kind);
  });
});

// ======== إضافة مادة ========
$('#addSubjectBtn').addEventListener('click',()=>{
  $('#subjectDialog').showModal();
  $('#subjectInput').value='';
  $('#iconPicked').value='📘';
  $('#moodPicked').value='😀';
  $('#colorPicked').value='#7E57C2';
});

$$('#iconRow button').forEach(btn=>{
  btn.addEventListener('click',()=>{
    $('#iconPicked').value = btn.textContent;
  });
});

$$('#moodRow button').forEach(btn=>{
  btn.addEventListener('click',()=>{
    $('#moodPicked').value = btn.textContent;
  });
});

$$('#colorRow button').forEach(btn=>{
  btn.addEventListener('click',()=>{
    $('#colorPicked').value = btn.dataset.color;
  });
});

$('#subjectDialog').addEventListener('close',e=>{
  if($('#subjectDialog').returnValue==='default'){
    const name = $('#subjectInput').value.trim();
    const icon = $('#iconPicked').value;
    const mood = $('#moodPicked').value;
    const color = $('#colorPicked').value;
    if(!name) return;
    state.subjects.push({id:uid(), name, icon, mood, color});
    save();
    renderHome();
  }
});

// ======== تعديل مادة ========
function openEditSubjectDialog(subj){
  $('#editSubjectDialog').showModal();
  $('#editSubjectInput').value = subj.name;
  $('#editIconPicked').value = subj.icon;
  $('#editMoodPicked').value = subj.mood;
  $('#editColorPicked').value = subj.color;
  
  // إضافة أحداث لأزرار التعديل
  $$('#editIconRow button').forEach(btn=>{
    btn.addEventListener('click',()=>{
      $('#editIconPicked').value = btn.textContent;
    });
  });

  $$('#editMoodRow button').forEach(btn=>{
    btn.addEventListener('click',()=>{
      $('#editMoodPicked').value = btn.textContent;
    });
  });

  $$('#editColorRow button').forEach(btn=>{
    btn.addEventListener('click',()=>{
      $('#editColorPicked').value = btn.dataset.color;
    });
  });
  
  // إضافة حدث لحذف المادة
  $('#deleteSubjectBtn').onclick = () => {
    $('#editSubjectDialog').close();
    showConfirmDialog('هل أنت متأكد من حذف هذه المادة وجميع محتوياتها؟', async () => {
      // حذف المادة
      state.subjects = state.subjects.filter(s => s.id !== subj.id);
      save();
      
      // حذف جميع العناصر المرتبطة بالمادة
      await idbDeleteBySubject(subj.id);
      
      renderHome();
    });
  };
}

$('#editSubjectDialog').addEventListener('close',e=>{
  if($('#editSubjectDialog').returnValue==='default'){
    const name = $('#editSubjectInput').value.trim();
    const icon = $('#editIconPicked').value;
    const mood = $('#editMoodPicked').value;
    const color = $('#editColorPicked').value;
    if(!name) return;
    
    const index = state.subjects.findIndex(s => s.id === state.selectedSubjectId);
    if(index !== -1){
      state.subjects[index] = {...state.subjects[index], name, icon, mood, color};
      save();
      openSubject(state.selectedSubjectId); // إعادة تحميل الشاشة
    }
  }
});

// ======== إضافة عناصر ========
$$('[data-add]').forEach(btn=>{
  btn.addEventListener('click',()=>{
    const kind = btn.dataset.add;
    $(`#${kind}Dialog`).showModal();
  });
});

// ملاحظة
$('#noteDialog').addEventListener('close',async e=>{
  if($('#noteDialog').returnValue==='default'){
    const text = $('#noteText').value.trim();
    if(!text) return;
    await idbAdd({
      id: uid(),
      subjectId: state.selectedSubjectId,
      kind: 'notes',
      text,
      createdAt: Date.now()
    });
    loadItems('notes');
  }
});

// ملف
$('#fileDialog').addEventListener('close',async e=>{
  if($('#fileDialog').returnValue==='default'){
    const file = $('#fileInput').files[0];
    if(!file) return;
    const title = $('#fileTitle').value.trim() || file.name;
    await idbAdd({
      id: uid(),
      subjectId: state.selectedSubjectId,
      kind: 'files',
      title,
      name: file.name,
      type: file.type,
      blob: file,
      createdAt: Date.now()
    });
    loadItems('files');
  }
});

// صورة
$('#imageDialog').addEventListener('close',async e=>{
  if($('#imageDialog').returnValue==='default'){
    const file = $('#imageInput').files[0];
    if(!file) return;
    await idbAdd({
      id: uid(),
      subjectId: state.selectedSubjectId,
      kind: 'images',
      name: file.name,
      type: file.type,
      blob: file,
      createdAt: Date.now()
    });
    loadItems('images');
  }
});

// صوت
$('#audioDialog').addEventListener('close',async e=>{
  if($('#audioDialog').returnValue==='default'){
    const file = $('#audioInput').files[0];
    if(!file) return;
    await idbAdd({
      id: uid(),
      subjectId: state.selectedSubjectId,
      kind: 'audio',
      name: file.name,
      type: file.type,
      blob: file,
      createdAt: Date.now()
    });
    loadItems('audio');
  }
});

// ======== التحديد والحذف ========
$('#cancelSelect').addEventListener('click',()=>{
  state.selecting = false;
  state.selectedIds.clear();
  $('#trashBar').classList.remove('show');
  $('#subject').classList.remove('selecting');
  updateSelectedCount();
});

$('#trashBtn').addEventListener('click',async ()=>{
  if(state.selectedIds.size===0) return;
  showConfirmDialog(`هل تريد حذف ${state.selectedIds.size} عنصر؟`, async () => {
    await idbDeleteMany([...state.selectedIds]);
    state.selecting = false;
    state.selectedIds.clear();
    $('#trashBar').classList.remove('show');
    $('#subject').classList.remove('selecting');
    renderTab($('.tab.active').dataset.tab);
  });
});

function updateSelectedCount(){
  $('#selectedCount').textContent = `${state.selectedIds.size} عنصر محدد`;
}

// ======== نافذة تأكيد الحذف ========
function showConfirmDialog(message, onConfirm) {
  $('#confirmMessage').textContent = message;
  $('#confirmDialog').showModal();
  
  $('#confirmDialog').addEventListener('close', function handler(e) {
    if ($('#confirmDialog').returnValue === 'default') {
      onConfirm();
    }
    $('#confirmDialog').removeEventListener('close', handler);
  });
}

// ======== أحداث أخرى ========
$('#backBtn').addEventListener('click',()=>renderHome());
$('#imageModal').addEventListener('click',()=>$('#imageModal').classList.remove('show'));

// بدء التطبيق
load();
renderHome();

// تفعيل وضع التحديد بالنقر المطول
let longPressTimer;
const subjectScreen = $('#subject');
subjectScreen.addEventListener('mousedown', e=>{
  if(!e.target.closest('.selectable')) return;
  longPressTimer = setTimeout(()=>{
    state.selecting = true;
    subjectScreen.classList.add('selecting');
    $('#trashBar').classList.add('show');
    const id = e.target.closest('.selectable').dataset.id;
    state.selectedIds.add(id);
    e.target.closest('.selectable').classList.add('selected');
    updateSelectedCount();
  }, 500);
});
subjectScreen.addEventListener('mouseup',()=>clearTimeout(longPressTimer));
subjectScreen.addEventListener('touchstart', e=>{
  if(!e.target.closest('.selectable')) return;
  longPressTimer = setTimeout(()=>{
    state.selecting = true;
    subjectScreen.classList.add('selecting');
    $('#trashBar').classList.add('show');
    const id = e.target.closest('.selectable').dataset.id;
    state.selectedIds.add(id);
    e.target.closest('.selectable').classList.add('selected');
    updateSelectedCount();
  }, 500);
});
subjectScreen.addEventListener('touchend',()=>clearTimeout(longPressTimer));