(() => {
  'use strict';

  /* ---------- Element refs ---------- */
  const app = document.getElementById('app');
  const sidebar = document.getElementById('sidebar');
  const sidebarOverlay = document.getElementById('sidebarOverlay');
  const collapseBtn = document.getElementById('collapseBtn');
  const sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
  const newChatBtn = document.getElementById('newChatBtn');
  const historyList = document.getElementById('historyList');
  const clearBtn = document.getElementById('clearBtn');
  const themeToggle = document.getElementById('themeToggle');

  const chatScroll = document.getElementById('chatScroll');
  const chatMessages = document.getElementById('chatMessages');
  const emptyState = document.getElementById('emptyState');
  const suggestions = document.getElementById('suggestions');

  const composerForm = document.getElementById('composerForm');
  const composerInput = document.getElementById('composerInput');
  const sendBtn = document.getElementById('sendBtn');
  const attachBtn = document.getElementById('attachBtn');
  const toastContainer = document.getElementById('toastContainer');

  const ASSISTANT_SVG = `<svg viewBox="0 0 24 24" fill="none"><path d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z" fill="url(#gmsg)"/><defs><linearGradient id="gmsg" x1="2" y1="2" x2="22" y2="22"><stop offset="0" stop-color="var(--accent-1)"/><stop offset="1" stop-color="var(--accent-2)"/></linearGradient></defs></svg>`;

  const STORAGE_KEY = 'nova-chat-state-v1';
  const THEME_KEY = 'nova-theme';

  /* ---------- State ---------- */
  /** @type {{id:string,title:string,messages:{role:'user'|'assistant',text:string,time:number}[]}[]} */
  let conversations = [];
  let activeId = null;

  /* ---------- Theme ---------- */
  function applyTheme(theme){
    if(theme === 'light'){
      document.documentElement.setAttribute('data-theme','light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    localStorage.setItem(THEME_KEY, theme);
  }
  function initTheme(){
    const saved = localStorage.getItem(THEME_KEY);
    if(saved){ applyTheme(saved); return; }
    const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    applyTheme(prefersLight ? 'light' : 'dark');
  }
  function toggleTheme(){
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    applyTheme(isLight ? 'dark' : 'light');
  }
  themeToggle.addEventListener('click', toggleTheme);
  themeToggle.addEventListener('keydown', (e) => {
    if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); toggleTheme(); }
  });

  /* ---------- Sidebar (one class, "sidebar-collapsed", drives both the
   * desktop inline-collapse and the mobile off-canvas drawer) ---------- */
  const mobileMql = window.matchMedia('(max-width: 860px)');
  function isMobile(){ return mobileMql.matches; }

  function setSidebarCollapsed(collapsed){
    app.classList.toggle('sidebar-collapsed', collapsed);
  }
  function toggleSidebar(){
    setSidebarCollapsed(!app.classList.contains('sidebar-collapsed'));
  }

  collapseBtn.addEventListener('click', toggleSidebar);
  sidebarToggleBtn.addEventListener('click', toggleSidebar);
  sidebarOverlay.addEventListener('click', () => setSidebarCollapsed(true));

  // Sensible default per viewport: open on desktop, closed (drawer) on mobile.
  setSidebarCollapsed(isMobile());

  // Re-apply the default whenever the viewport crosses the mobile/desktop
  // breakpoint, so resizing/rotating never leaves the sidebar stuck in a
  // state that doesn't fit the new layout. Both the matchMedia "change"
  // event and a debounced window "resize" fallback are wired up, since not
  // every environment reliably fires the former on a programmatic resize.
  let lastIsMobile = isMobile();
  function reconcileSidebarForViewport(){
    const nowMobile = isMobile();
    if(nowMobile !== lastIsMobile){
      lastIsMobile = nowMobile;
      setSidebarCollapsed(nowMobile);
    }
  }
  mobileMql.addEventListener('change', reconcileSidebarForViewport);
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(reconcileSidebarForViewport, 150);
  });

  /* ---------- Toasts ---------- */
  const TOAST_ICON = `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M12 8v5M12 16h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
  function showToast(message, duration = 3200){
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.setAttribute('role', 'status');
    toast.innerHTML = `${TOAST_ICON}<span></span>`;
    toast.querySelector('span').textContent = message;
    toastContainer.appendChild(toast);

    const remove = () => {
      toast.classList.add('leaving');
      toast.addEventListener('animationend', () => toast.remove(), { once: true });
    };
    setTimeout(remove, duration);
  }

  attachBtn.addEventListener('click', () => {
    showToast("Attachments aren't available yet.");
  });

  /* ---------- Persistence ---------- */
  function save(){
    try{
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ conversations, activeId }));
    }catch(e){ /* storage unavailable — fail silently */ }
  }
  function load(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return false;
      const parsed = JSON.parse(raw);
      if(!parsed || !Array.isArray(parsed.conversations)) return false;
      conversations = parsed.conversations;
      activeId = parsed.activeId;
      return true;
    }catch(e){ return false; }
  }

  function uid(){ return Math.random().toString(36).slice(2,9) + Date.now().toString(36); }

  function getActive(){ return conversations.find(c => c.id === activeId) || null; }

  function createConversation(){
    const convo = { id: uid(), title: 'New chat', messages: [] };
    conversations.unshift(convo);
    activeId = convo.id;
    return convo;
  }

  /* ---------- Rendering: history list ---------- */
  function renderHistory(){
    historyList.innerHTML = '';
    conversations.forEach(c => {
      const item = document.createElement('div');
      item.className = 'history-item' + (c.id === activeId ? ' active' : '');
      item.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none"><path d="M4 4h16v12H7l-3 3V4Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
        <span>${escapeHtml(c.title || 'New chat')}</span>`;
      item.addEventListener('click', () => {
        activeId = c.id;
        renderHistory();
        renderMessages();
        save();
        if(isMobile()) setSidebarCollapsed(true);
      });
      historyList.appendChild(item);
    });
  }

  /* ---------- Rendering: messages ---------- */
  function renderMessages(){
    chatMessages.querySelectorAll('.msg').forEach(n => n.remove());
    const convo = getActive();
    const hasMessages = convo && convo.messages.length > 0;
    emptyState.style.display = hasMessages ? 'none' : '';
    if(!hasMessages) return;

    convo.messages.forEach(m => {
      chatMessages.appendChild(buildMessageEl(m.role, m.text, m.time, false));
    });
    scrollToBottom();
  }

  function formatTime(ts){
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function escapeHtml(str){
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /** Very small markdown-ish formatter: code blocks, inline code, bold, line breaks */
  function formatText(raw){
    let text = escapeHtml(raw);
    text = text.replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${code.trim()}</code></pre>`);
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g,'<br>')}</p>`).join('');
    return text;
  }

  function buildMetaRow(role, text, time){
    const metaRow = document.createElement('div');
    metaRow.style.display = 'flex';
    metaRow.style.alignItems = 'center';
    metaRow.style.gap = '8px';

    const timeEl = document.createElement('span');
    timeEl.className = 'msg-time';
    timeEl.textContent = formatTime(time);
    metaRow.appendChild(timeEl);

    if(role === 'assistant'){
      const actions = document.createElement('div');
      actions.className = 'msg-actions';
      actions.innerHTML = `
        <button type="button" class="copy-btn" title="Copy">
          <svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M5 15V5a2 2 0 0 1 2-2h10" stroke="currentColor" stroke-width="1.8" fill="none"/></svg>
        </button>`;
      actions.querySelector('.copy-btn').addEventListener('click', (e) => {
        navigator.clipboard?.writeText(text).then(() => {
          const btn = e.currentTarget;
          btn.classList.add('copied');
          setTimeout(() => btn.classList.remove('copied'), 1200);
        }).catch(() => {});
      });
      metaRow.appendChild(actions);
    }
    return metaRow;
  }

  function buildMessageEl(role, text, time, animate){
    const wrap = document.createElement('div');
    wrap.className = `msg ${role}`;

    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    avatar.innerHTML = role === 'user' ? 'U' : ASSISTANT_SVG;

    const body = document.createElement('div');
    body.className = 'msg-body';

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.innerHTML = formatText(text);

    body.appendChild(bubble);
    body.appendChild(buildMetaRow(role, text, time));
    wrap.appendChild(avatar);
    wrap.appendChild(body);

    if(!animate) wrap.style.animation = 'none';
    return wrap;
  }

  function scrollToBottom(){
    requestAnimationFrame(() => {
      chatScroll.scrollTop = chatScroll.scrollHeight;
    });
  }

  /* ---------- Typing indicator ---------- */
  function showTypingIndicator(){
    const wrap = document.createElement('div');
    wrap.className = 'msg assistant';
    wrap.id = 'typingIndicator';
    wrap.innerHTML = `
      <div class="msg-avatar">${ASSISTANT_SVG}</div>
      <div class="msg-body">
        <div class="msg-bubble typing-bubble"><span></span><span></span><span></span></div>
      </div>`;
    chatMessages.appendChild(wrap);
    scrollToBottom();
    return wrap;
  }

  /* ---------- Server-sent event parsing ----------
   * The backend re-emits OpenAI's stream as simple SSE records:
   *   data: {"text":"..."}\n\n           -> a content chunk
   *   event: error\ndata: {"message":""} -> a fatal error
   */
  async function streamChat(messages, onChunk){
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    });

    if(!response.body){
      throw new Error('This browser could not read the response stream.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while(true){
      const { value, done } = await reader.read();
      if(done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary;
      while((boundary = buffer.indexOf('\n\n')) !== -1){
        const record = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const lines = record.split('\n');

        let event = 'message';
        let dataStr = '';
        for(const line of lines){
          if(line.startsWith('event:')) event = line.slice(6).trim();
          else if(line.startsWith('data:')) dataStr += line.slice(5).trim();
        }
        if(!dataStr) continue;

        let parsed;
        try{ parsed = JSON.parse(dataStr); } catch { continue; }

        if(event === 'error'){
          throw new Error(parsed.message || 'Something went wrong.');
        }
        if(parsed.text) onChunk(parsed.text);
      }
    }
  }

  async function requestAssistantReply(convo){
    const typingEl = showTypingIndicator();
    let wrap = null, bubble = null, caret = null;
    let assembled = '';
    let started = false;

    const beginBubble = () => {
      typingEl.remove();
      wrap = document.createElement('div');
      wrap.className = 'msg assistant';
      const avatar = document.createElement('div');
      avatar.className = 'msg-avatar';
      avatar.innerHTML = ASSISTANT_SVG;
      const body = document.createElement('div');
      body.className = 'msg-body';
      bubble = document.createElement('div');
      bubble.className = 'msg-bubble';
      caret = document.createElement('span');
      caret.className = 'caret';
      bubble.appendChild(caret);
      body.appendChild(bubble);
      wrap.appendChild(avatar);
      wrap.appendChild(body);
      chatMessages.appendChild(wrap);
      started = true;
    };

    try{
      const history = convo.messages.map(m => ({ role: m.role, content: m.text }));
      await streamChat(history, (chunk) => {
        if(!started) beginBubble();
        assembled += chunk;
        bubble.innerHTML = formatText(assembled);
        bubble.appendChild(caret);
        scrollToBottom();
      });

      if(!started){
        // Stream completed with no content at all — treat as a soft failure.
        throw new Error('No reply was returned.');
      }

      caret.remove();
      const time = Date.now();
      wrap.querySelector('.msg-body').appendChild(buildMetaRow('assistant', assembled, time));
      convo.messages.push({ role: 'assistant', text: assembled, time });
      save();
    } catch(err){
      if(!started){ typingEl.remove(); }
      const time = Date.now();
      const message = (err && err.message) ? err.message : 'Something went wrong talking to the server.';
      const errorEl = document.createElement('div');
      errorEl.className = 'msg assistant';
      errorEl.innerHTML = `
        <div class="msg-avatar">${ASSISTANT_SVG}</div>
        <div class="msg-body">
          <div class="msg-bubble error">⚠️ ${escapeHtml(message)}</div>
        </div>`;
      errorEl.querySelector('.msg-body').appendChild(buildMetaRow('system', '', time));
      chatMessages.appendChild(errorEl);
      scrollToBottom();
    }
  }

  /* ---------- Sending a message ---------- */
  let isGenerating = false;

  async function sendMessage(text){
    text = text.trim();
    if(!text || isGenerating) return;

    let convo = getActive();
    if(!convo){ convo = createConversation(); }

    const wasEmpty = convo.messages.length === 0;
    const time = Date.now();
    convo.messages.push({ role: 'user', text, time });
    if(wasEmpty){
      convo.title = text.length > 36 ? text.slice(0, 36) + '…' : text;
    }
    save();

    emptyState.style.display = 'none';
    chatMessages.appendChild(buildMessageEl('user', text, time, true));
    scrollToBottom();
    renderHistory();

    composerInput.value = '';
    autoResize();
    updateSendState();

    isGenerating = true;
    sendBtn.disabled = true;

    await requestAssistantReply(convo);

    isGenerating = false;
    updateSendState();
  }

  composerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    sendMessage(composerInput.value);
  });

  composerInput.addEventListener('keydown', (e) => {
    if(e.key === 'Enter' && !e.shiftKey){
      e.preventDefault();
      sendMessage(composerInput.value);
    }
  });

  function autoResize(){
    composerInput.style.height = 'auto';
    composerInput.style.height = Math.min(composerInput.scrollHeight, 160) + 'px';
  }
  function updateSendState(){
    sendBtn.disabled = isGenerating || composerInput.value.trim().length === 0;
  }
  composerInput.addEventListener('input', () => { autoResize(); updateSendState(); });

  suggestions.addEventListener('click', (e) => {
    const chip = e.target.closest('.suggestion-chip');
    if(!chip) return;
    composerInput.value = chip.dataset.text;
    autoResize();
    updateSendState();
    sendMessage(chip.dataset.text);
  });

  /* ---------- New chat / clear ---------- */
  newChatBtn.addEventListener('click', () => {
    createConversation();
    renderHistory();
    renderMessages();
    save();
    composerInput.focus();
    if(isMobile()) setSidebarCollapsed(true);
  });

  clearBtn.addEventListener('click', () => {
    const convo = getActive();
    if(!convo || convo.messages.length === 0) return;
    convo.messages = [];
    convo.title = 'New chat';
    renderHistory();
    renderMessages();
    save();
  });

  /* ---------- Init ---------- */
  function init(){
    initTheme();
    const loaded = load();
    if(!loaded || conversations.length === 0){
      createConversation();
    } else if(!getActive()){
      activeId = conversations[0].id;
    }
    renderHistory();
    renderMessages();
    updateSendState();
  }

  init();
})();
