// The personal assistant chat panel: text + voice in, text + speech out.
import { api, state } from './api.js';
import { $, fmtTime, html, icon, md, toastError } from './ui.js';

const SUGGESTIONS = [
  'What do I have today?',
  'How is my blood pressure?',
  'Summarize my reports',
  'Remind me to drink water every day at 11am',
  'How is my family doing?',
];

let root = null;
let fab = null;
let loaded = false;
let sending = false;
let recognition = null;

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

// Speech output
function pickVoice() {
  const voices = window.speechSynthesis?.getVoices() || [];
  return voices.find((v) => /en-IN/i.test(v.lang))
    || voices.find((v) => /en-GB/i.test(v.lang) && /female|samantha|libby|sonia/i.test(v.name))
    || voices.find((v) => /^en/i.test(v.lang));
}

export function speak(text, force = false) {
  if (!('speechSynthesis' in window) || (!force && !state.user?.voice_enabled)) return;
  const clean = String(text)
    .replace(/\*\*|__|_/g, '')
    .replace(/•/g, '. ')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
    .replace(/\bBP\b/g, 'B P')
    .replace(/(\d+)\/(\d+) mmHg/g, '$1 over $2')
    .replace(/mg\/dL/g, 'milligrams per decilitre');
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(clean);
  u.voice = pickVoice() || null;
  u.rate = 1;
  u.pitch = 1.05;
  window.speechSynthesis.speak(u);
}

// Rendering
function bubble(role, text, time = new Date()) {
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  el.innerHTML = html`${role === 'assistant' ? md(text) : text}<span class="time">${fmtTime(time)}</span>`;
  return el;
}

function append(role, text, time) {
  const log = $('[data-log]', root);
  log.append(bubble(role, text, time));
  log.scrollTop = log.scrollHeight;
}

function typing(on) {
  const log = $('[data-log]', root);
  log.querySelector('.typing')?.remove();
  if (on) {
    const t = document.createElement('div');
    t.className = 'msg assistant typing';
    t.innerHTML = '<i></i><i></i><i></i>';
    log.append(t);
    log.scrollTop = log.scrollHeight;
  }
}

function header() {
  const u = state.user;
  return html`
    <div class="bot zen-avatar" aria-hidden="true"></div>
    <div class="grow"><b>${u.assistant_name}</b><div class="status">${state.aiEnabled ? 'Online' : 'Online, basic mode'}</div></div>
    <button class="icon-btn sm" data-voice title="${u.voice_enabled ? 'Voice replies on' : 'Voice replies off'}" aria-label="Toggle voice replies">${icon(u.voice_enabled ? 'volume' : 'mute')}</button>
    <button class="icon-btn sm" data-clear title="Clear conversation" aria-label="Clear conversation">${icon('trash')}</button>
    <button class="icon-btn sm" data-close aria-label="Close assistant">${icon('x')}</button>`;
}

export function updateIdentity() {
  if (!root) return;
  $('.chat-head', root).innerHTML = header();
  fab.querySelector('span').textContent = `Talk to ${state.user.assistant_name}`;
}

async function loadHistory() {
  const { messages, greeting } = await api('/api/assistant/history');
  const log = $('[data-log]', root);
  log.innerHTML = '';
  if (!messages.length) {
    const intro = `${greeting.greeting} I'm ${state.user.assistant_name}, your personal health assistant. ${greeting.lines.slice(0, 2).join(' ')}\n\nHow can I help you today?`;
    append('assistant', intro);
  }
  for (const m of messages) append(m.role, m.content, m.created_at);
  loaded = true;
}

async function send(text) {
  text = text.trim();
  if (!text || sending) return;
  sending = true;
  const input = $('[data-input]', root);
  input.value = '';
  $('.suggestions', root).hidden = true;
  append('user', text);
  typing(true);
  try {
    const { reply } = await api('/api/assistant/chat', { method: 'POST', body: { message: text } });
    typing(false);
    append('assistant', reply);
    speak(reply);
  } catch (err) {
    typing(false);
    append('assistant', `Sorry, I couldn't reach the server just now (${err.message}). Please try again in a moment.`);
  } finally {
    sending = false;
    input.focus();
  }
}

function toggleMic(btn) {
  if (recognition) { recognition.stop(); return; }
  recognition = new Recognition();
  recognition.lang = navigator.language?.startsWith('en') ? navigator.language : 'en-IN';
  recognition.interimResults = true;
  recognition.continuous = false;
  const input = $('[data-input]', root);
  let finalText = '';
  recognition.onresult = (e) => {
    finalText = [...e.results].map((r) => r[0].transcript).join(' ');
    input.value = finalText;
  };
  recognition.onerror = (e) => {
    if (e.error === 'not-allowed') toastError(new Error('Microphone access was blocked. Allow it in your browser to talk to me.'));
  };
  recognition.onend = () => {
    btn.classList.remove('listening');
    recognition = null;
    if (finalText.trim()) send(finalText);
  };
  window.speechSynthesis?.cancel();
  btn.classList.add('listening');
  recognition.start();
}

// Lifecycle
export function mount() {
  unmount();
  fab = document.createElement('button');
  fab.className = 'fab';
  fab.innerHTML = html`<span class="zen-avatar sm" aria-hidden="true"></span><span>Talk to ${state.user.assistant_name}</span>`;
  fab.onclick = open;

  root = document.createElement('section');
  root.className = 'chat';
  root.hidden = true;
  root.setAttribute('aria-label', 'Health assistant chat');
  root.innerHTML = html`
    <div class="chat-head"></div>
    <div class="chat-log" data-log></div>
    <div class="suggestions">${SUGGESTIONS.map((s) => html`<button type="button">${s}</button>`)}</div>
    <form class="chat-input">
      ${Recognition ? html`<button type="button" class="icon-btn mic" data-mic aria-label="Speak to your assistant">${icon('mic')}</button>` : ''}
      <input data-input placeholder="Type or tap the mic…" autocomplete="off" maxlength="2000" aria-label="Message">
      <button class="icon-btn send" aria-label="Send">${icon('send')}</button>
    </form>
    <div class="mode-note">${state.aiEnabled ? 'Not a substitute for medical advice. In an emergency, call 112.' : 'Built-in mode · In an emergency, call 112.'}</div>`;
  $('.chat-head', root).innerHTML = header();

  root.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) return close();
    if (e.target.closest('[data-mic]')) return toggleMic(e.target.closest('[data-mic]'));
    if (e.target.closest('.suggestions button')) return send(e.target.closest('button').textContent);
    if (e.target.closest('[data-voice]')) {
      const on = !state.user.voice_enabled;
      try {
        const { user } = await api('/api/auth/me', { method: 'PUT', body: { voice_enabled: on } });
        state.user = user;
        updateIdentity();
        if (on) speak("Okay, I'll read my replies out loud.");
        else window.speechSynthesis?.cancel();
      } catch (err) { toastError(err); }
    }
    if (e.target.closest('[data-clear]')) {
      await api('/api/assistant/history', { method: 'DELETE' }).catch(toastError);
      $('.suggestions', root).hidden = false;
      loadHistory();
    }
  });
  root.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    send($('[data-input]', root).value);
  });
  root.addEventListener('keydown', (e) => e.key === 'Escape' && close());

  document.body.append(fab, root);
  loaded = false;
}

export function unmount() {
  root?.remove();
  fab?.remove();
  root = fab = null;
  recognition?.stop();
}

export async function open() {
  if (!root) return;
  root.hidden = false;
  fab.hidden = true;
  $('[data-input]', root).focus();
  if (!loaded) await loadHistory().catch(toastError);
}

export function close() {
  if (!root) return;
  root.hidden = true;
  fab.hidden = false;
  window.speechSynthesis?.cancel();
}
