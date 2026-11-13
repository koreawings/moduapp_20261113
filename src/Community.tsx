import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Ban, Check, ChevronRight, Flag, Hash, Info, LockKeyhole, LogIn, LogOut, MessageCircle, MessagesSquare, PenLine, Plus, RefreshCw, Send, Shield, Users, X } from 'lucide-react';
import { ApiError, api, errorMessage } from './api';
import { EmptyState, ErrorNote, ReportModal } from './components';
import { formatDate, type T } from './i18n';
import type { Language, Message, PendingMessage, Post, Room, User } from './types';

type Props = { user: User | null; lang: Language; t: T; onAuth: () => void; onToast: (text: string) => void; context?: string; onClearContext: () => void };
type Tab = 'board' | 'chat' | 'blocked' | 'feedback';

export default function Community(props: Props) {
  const { user, t, context, onClearContext } = props;
  const [tab, setTab] = useState<Tab>(context ? 'chat' : 'board');
  useEffect(() => { if (context) setTab('chat'); }, [context]);
  return <section className="page-shell community-page"><div className="page-intro"><span className="eyebrow">ON THE TRAIL, TOGETHER</span><h1>{t('communityTitle')}</h1><p>{t('communityBody')}</p></div>
    {user?.suspended && <div className="notice error-note"><Shield size={20} /><p>{t('suspended')}</p></div>}
    <div className="section-tabs" aria-label={t('community')} role="tablist">{([['board', PenLine], ['chat', MessagesSquare], ['blocked', Shield], ['feedback', MessageCircle]] as const).map(([key, Icon]) => <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'selected' : ''} onClick={() => setTab(key)}><Icon size={17} />{t(key)}</button>)}</div>
    {context && <div className="context-banner"><Info size={18} /><p>{context}</p><button className="icon-button" onClick={onClearContext} aria-label={t('close')}><X size={16} /></button></div>}
    {tab === 'board' && <Board key={user?.id ?? 'guest'} {...props} />}{tab === 'chat' && <ChatPanel key={user?.id ?? 'guest'} {...props} />}{tab === 'blocked' && <BlockedPanel key={user?.id ?? 'guest'} {...props} />}{tab === 'feedback' && <FeedbackPanel key={user?.id ?? 'guest'} {...props} />}
  </section>;
}

function JoinPrompt({ t, onAuth }: { t: T; onAuth: () => void }) {
  return <div className="join-prompt"><span className="join-icon"><Users size={27} /></span><div><strong>{t('signInToJoin')}</strong><p>{t('authBody')}</p></div><button className="button button-primary" onClick={onAuth}>{t('login')}<ArrowRight size={17} /></button></div>;
}

function Avatar({ name }: { name: string }) { return <span className="avatar" aria-hidden="true">{name.trim().slice(0, 1).toUpperCase() || 'K'}</span>; }

function Board({ user, lang, t, onAuth, onToast }: Props) {
  const [posts, setPosts] = useState<Post[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [writing, setWriting] = useState(false); const [title, setTitle] = useState(''); const [body, setBody] = useState(''); const [busy, setBusy] = useState(false); const [writeError, setWriteError] = useState('');
  const [report, setReport] = useState<{ targetType: 'post' | 'comment'; targetId: string } | null>(null);
  const refresh = useCallback(async () => { setError(''); try { const data = await api<{ posts: Post[] }>('/posts'); setPosts(data.posts); } catch (error) { setPosts([]); setError(errorMessage(error)); } finally { setLoading(false); } }, []);
  useEffect(() => { void refresh(); }, [refresh, user?.id]);
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setWriteError(''); try { await api('/posts', { method: 'POST', body: { title, body } }); setWriting(false); setTitle(''); setBody(''); onToast(t('savedSuccess')); await refresh(); } catch (error) { setWriteError(errorMessage(error)); } finally { setBusy(false); } }
  async function block(userId: string) { try { await api('/blocks', { method: 'POST', body: { userId } }); onToast(t('savedSuccess')); await refresh(); } catch (error) { setError(errorMessage(error)); } }
  return <div className="board-layout"><div className="board-main">{!user && <JoinPrompt t={t} onAuth={onAuth} />}<div className="section-toolbar"><h2>{t('newest')} <span className="count-pill">{posts.length}</span></h2><button className="button button-primary button-small" onClick={() => user ? setWriting(!writing) : onAuth()} disabled={user?.suspended}><Plus size={17} />{t('writePost')}</button></div>
    {writing && <form className="panel form-stack post-form" onSubmit={submit}><label>{t('postTitle')}<input value={title} onChange={e => setTitle(e.target.value)} required minLength={2} maxLength={120} /></label><label>{t('postBody')}<textarea value={body} onChange={e => setBody(e.target.value)} required minLength={2} maxLength={5000} rows={5} /></label>{writeError && <p role="alert" className="form-error">{writeError}</p>}<div className="form-actions"><button type="button" className="button button-ghost" onClick={() => setWriting(false)}>{t('cancel')}</button><button className="button button-primary" disabled={busy}>{busy ? t('loading') : t('publish')}<Send size={16} /></button></div></form>}
    {error && <ErrorNote message={error} onRetry={() => void refresh()} t={t} />}{loading ? <p className="loading-line" role="status">{t('loading')}</p> : !error && posts.length === 0 ? <EmptyState title={t('noPosts')} body={t('noPostsBody')} /> : posts.map(post => <article className="post-card" key={post.id}><div className="post-author"><Avatar name={post.authorName} /><div><strong>{post.authorName}</strong><time dateTime={post.createdAt}>{formatDate(post.createdAt, lang)}</time></div>{user && user.id !== post.authorId && <div className="post-tools"><button className="icon-button" aria-label={t('report')} title={t('report')} onClick={() => setReport({ targetType: 'post', targetId: post.id })}><Flag size={16} /></button><button className="icon-button" aria-label={t('block')} title={t('block')} onClick={() => void block(post.authorId)}><Ban size={16} /></button></div>}</div><h3>{post.title}</h3><p className="user-content post-text">{post.body}</p><div className="comments-heading"><MessageCircle size={15} />{t('comment')} {post.comments?.length ?? 0}</div>{(post.comments?.length ?? 0) >= 100 && <p className="fine-print">{t('commentLimit')}</p>}<div className="comments-list">{(post.comments ?? []).map(comment => <div className="comment-row" key={comment.id}><Avatar name={comment.authorName} /><div><strong>{comment.authorName}</strong><span className="comment-date">{formatDate(comment.createdAt, lang)}</span><p className="user-content">{comment.body}</p></div>{user && user.id !== comment.authorId && <button className="icon-button" aria-label={t('report')} title={t('report')} onClick={() => setReport({ targetType: 'comment', targetId: comment.id })}><Flag size={14} /></button>}</div>)}</div>{user && !user.suspended ? <CommentForm postId={post.id} t={t} onSaved={refresh} /> : !user && <button className="text-button muted" onClick={onAuth}>{t('loginRequired')}</button>}</article>)}
  </div><aside className="community-aside"><span className="aside-icon"><LeafIcon /></span><span className="eyebrow">A LITTLE KINDNESS</span><h3>{t('footerLine')}</h3><p>{t('blockBody')}</p><div className="aside-divider" /><p><Shield size={17} />{t('chatNotEmergency')}</p><button className="button button-outline button-full" onClick={() => void refresh()}><RefreshCw size={16} />{t('refresh')}</button></aside>{report && <ReportModal target={report} t={t} onClose={() => setReport(null)} onSuccess={onToast} />}</div>;
}

function LeafIcon() { return <svg width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden="true"><path d="M28 7C12 5 4 14 9 23c4 9 20 6 19-16Z" stroke="currentColor" strokeWidth="1.5" /><path d="m8 30 15-17M14 23l-1-7m7 1 6 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>; }

function CommentForm({ postId, t, onSaved }: { postId: string; t: T; onSaved: () => Promise<void> }) {
  const [body, setBody] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setError(''); try { await api(`/posts/${encodeURIComponent(postId)}/comments`, { method: 'POST', body: { body } }); setBody(''); await onSaved(); } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); } }
  return <form className="comment-form" onSubmit={submit}><label className="sr-only" htmlFor={`comment-${postId}`}>{t('comment')}</label><input id={`comment-${postId}`} placeholder={t('commentPlaceholder')} value={body} onChange={e => setBody(e.target.value)} required maxLength={2000} /><button className="icon-button" disabled={busy || !body.trim()} aria-label={t('addComment')}><Send size={18} /></button>{error && <p className="form-error" role="alert">{error}</p>}</form>;
}

function ChatPanel({ user, lang, t, onAuth, onToast }: Props) {
  const [rooms, setRooms] = useState<Room[]>([]); const [selectedId, setSelectedId] = useState(''); const [roomsError, setRoomsError] = useState(''); const [roomsLoading, setRoomsLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<{ roomId: string; userId: string; messages: Message[] }>({ roomId: '', userId: '', messages: [] }); const [messageError, setMessageError] = useState(''); const [loadingMessages, setLoadingMessages] = useState(false);
  const messages = snapshot.roomId === selectedId && snapshot.userId === user?.id ? snapshot.messages : [];
  const setMessages = useCallback((next: Message[] | ((current: Message[]) => Message[])) => { setSnapshot(current => ({ roomId: selectedId, userId: user?.id ?? '', messages: typeof next === 'function' ? next(current.roomId === selectedId && current.userId === user?.id ? current.messages : []) : next })); }, [selectedId, user?.id]);
  const [draft, setDraft] = useState(''); const [pending, setPending] = useState<PendingMessage[]>([]); const [membershipBusy, setMembershipBusy] = useState(false);
  const [report, setReport] = useState<{ targetType: 'message'; targetId: string } | null>(null);
  const sendControllers = useRef(new Map<string, AbortController>()); const messagePane = useRef<HTMLDivElement>(null); const previousRoom = useRef(''); const roomsGeneration = useRef(0); const requestContext = useRef(''); requestContext.current = `${selectedId}:${user?.id ?? ''}`;
  const selected = rooms.find(room => room.id === selectedId);
  const refreshRooms = useCallback(async () => { const generation = ++roomsGeneration.current; try { const data = await api<{ rooms: Room[] }>('/rooms'); if (generation === roomsGeneration.current) { setRooms(data.rooms); setRoomsError(''); } } catch (error) { if (generation === roomsGeneration.current) setRoomsError(errorMessage(error)); } finally { if (generation === roomsGeneration.current) setRoomsLoading(false); } }, []);
  useEffect(() => { void refreshRooms(); }, [refreshRooms, user?.id]);
  useEffect(() => {
    setMessages([]); setMessageError('');
    const roomSession = `${selectedId}:${user?.id ?? ''}`;
    if (previousRoom.current !== roomSession) { sendControllers.current.forEach(controller => controller.abort()); sendControllers.current.clear(); setPending([]); setDraft(''); previousRoom.current = roomSession; }
    if (!user || !selected?.joined) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>; let active = true; setLoadingMessages(true);
    async function poll() {
      try {
        const data = await api<{ messages: Message[] }>(`/rooms/${encodeURIComponent(selectedId)}/messages`, { signal: controller.signal });
        if (active) { setMessages(data.messages); setMessageError(''); setPending(current => current.filter(item => !data.messages.some(message => message.authorId === user?.id && message.clientMessageId === item.clientMessageId))); }
      } catch (error) {
        if (active && !(error instanceof DOMException && error.name === 'AbortError')) { setMessages([]); setMessageError(errorMessage(error)); if (error instanceof ApiError && [401, 403].includes(error.status)) void refreshRooms(); }
      } finally {
        if (active) { setLoadingMessages(false); timer = setTimeout(() => { void refreshRooms(); void poll(); }, 3000); }
      }
    }
    void poll(); return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, [selectedId, selected?.joined, user?.id, refreshRooms, setMessages]);
  useEffect(() => { const controllers = sendControllers.current; return () => { controllers.forEach(controller => controller.abort()); controllers.clear(); }; }, []);
  useEffect(() => { const pane = messagePane.current; if (pane && (pane.scrollHeight - pane.scrollTop - pane.clientHeight < 220 || messages.length < 5)) pane.scrollTop = pane.scrollHeight; }, [messages.length, pending.length]);
  async function membership(join: boolean) {
    if (!user) { onAuth(); return; } if (!selected) return;
    const contextKey = `${selected.id}:${user.id}`;
    roomsGeneration.current += 1; setMembershipBusy(true); setMessageError('');
    try { await api(`/rooms/${encodeURIComponent(selected.id)}/${join ? 'join' : 'membership'}`, { method: join ? 'POST' : 'DELETE', body: {} }); if (!join && requestContext.current === contextKey) { setMessages([]); sendControllers.current.forEach(controller => controller.abort()); setPending([]); } await refreshRooms(); }
    catch (error) { if (requestContext.current === contextKey) setMessageError(errorMessage(error)); } finally { setMembershipBusy(false); }
  }
  async function sendPending(item: PendingMessage) {
    if (sendControllers.current.has(item.clientMessageId)) return;
    const controller = new AbortController(); const contextKey = `${item.roomId}:${user?.id ?? ''}`; sendControllers.current.set(item.clientMessageId, controller);
    setPending(current => current.map(p => p.clientMessageId === item.clientMessageId ? { ...p, state: 'sending', error: undefined } : p));
    try {
      const data = await api<{ message: Message }>(`/rooms/${encodeURIComponent(item.roomId)}/messages`, { method: 'POST', body: { body: item.body, clientMessageId: item.clientMessageId }, signal: controller.signal });
      if (!controller.signal.aborted && requestContext.current === contextKey) { setPending(current => current.filter(p => p.clientMessageId !== item.clientMessageId)); setMessages(current => current.some(m => m.id === data.message.id) ? current : [...current, data.message]); }
    } catch (error) {
      if (requestContext.current !== contextKey) return;
      const cancelled = error instanceof DOMException && error.name === 'AbortError';
      setPending(current => current.map(p => p.clientMessageId === item.clientMessageId ? { ...p, state: cancelled ? 'cancelled' : 'failed', error: cancelled ? undefined : errorMessage(error) } : p));
      if (error instanceof ApiError && [401, 403].includes(error.status)) { setMessages([]); setMessageError(errorMessage(error)); void refreshRooms(); }
    } finally { sendControllers.current.delete(item.clientMessageId); }
  }
  function submitMessage(event: FormEvent) {
    event.preventDefault(); if (!draft.trim() || !selected?.joined || selected.locked || !user || user.suspended) return;
    const item: PendingMessage = { clientMessageId: crypto.randomUUID(), roomId: selected.id, body: draft.trim(), state: 'sending' };
    setPending(current => [...current, item]); setDraft(''); void sendPending(item);
    requestAnimationFrame(() => { if (messagePane.current) messagePane.current.scrollTop = messagePane.current.scrollHeight; });
  }
  async function block(userId: string) { try { await api('/blocks', { method: 'POST', body: { userId } }); setMessages(current => current.filter(m => m.authorId !== userId)); onToast(t('savedSuccess')); } catch (error) { setMessageError(errorMessage(error)); } }
  return <><p className="section-description">{t('roomPrivacy')}</p><div className="chat-layout"><aside className="room-list"><div className="room-list-heading"><h2>{t('chat')}</h2><button className="icon-button" onClick={() => void refreshRooms()} aria-label={t('refresh')}><RefreshCw size={17} /></button></div>{roomsError && <ErrorNote message={roomsError} t={t} onRetry={() => void refreshRooms()} />}{roomsLoading && <p className="loading-line">{t('loading')}</p>}{!roomsLoading && !roomsError && rooms.length === 0 && <p className="fine-print">{t('noItems')}</p>}{rooms.map(room => <button className={`room-item ${selectedId === room.id ? 'selected' : ''}`} key={room.id} onClick={() => setSelectedId(room.id)}><span className="room-symbol"><Hash size={22} /></span><span><strong>{room.name}</strong><small>{room.joined ? t('joined') : room.description}</small></span>{room.locked ? <LockKeyhole size={15} /> : <ChevronRight size={15} />}</button>)}<div className="room-guidance"><Shield size={19} /><p>{t('chatNotEmergency')}</p><p>{t('blockBody')}</p></div></aside>
    <div className="chat-conversation">{!selected ? <EmptyState title={t('selectRoom')} body={t('roomPrivacy')} /> : <><div className="chat-heading"><span className="room-symbol"><Hash size={23} /></span><div><h2>{selected.name}</h2><small>{selected.locked ? t('locked') : t('polling')}</small></div>{selected.joined && <button className="button button-small button-ghost" disabled={membershipBusy} onClick={() => void membership(false)}><LogOut size={15} />{t('leaveRoom')}</button>}</div>
    {!user ? <div className="chat-gate"><JoinPrompt t={t} onAuth={onAuth} /></div> : !selected.joined ? <div className="chat-gate"><EmptyState title={selected.name} body={selected.description}><button className="button button-primary" onClick={() => void membership(true)} disabled={membershipBusy || user.suspended}><LogIn size={17} />{membershipBusy ? t('loading') : t('joinRoom')}</button></EmptyState>{messageError && <ErrorNote message={messageError} t={t} />}</div> : <><p className="history-note"><Info size={14} />{t('membershipHistory')} {t('historyLimit')}</p>{messageError && <div className="chat-access-error" role="alert"><strong>{t('messagesUnavailable')}</strong><p>{messageError}</p></div>}<div className="message-list" ref={messagePane} aria-label={t('chat')}>
    {loadingMessages && <p className="loading-line">{t('loading')}</p>}{!loadingMessages && !messageError && messages.length === 0 && <div className="chat-empty"><MessagesSquare size={32} /><p>{t('emptyMessages')}</p></div>}
    {messages.map(message => <div className={`message-row ${message.authorId === user.id ? 'own' : ''}`} key={message.id}>{message.authorId !== user.id && <Avatar name={message.authorName} />}<div className="message-content"><div className="message-label"><strong>{message.authorName}</strong><time dateTime={message.createdAt}>{formatDate(message.createdAt, lang)}</time></div><p className="message-bubble user-content">{message.body}</p>{message.authorId !== user.id && <div className="message-actions"><button onClick={() => setReport({ targetType: 'message', targetId: message.id })}><Flag size={12} />{t('report')}</button><button onClick={() => void block(message.authorId)}><Ban size={12} />{t('block')}</button></div>}</div></div>)}
    {pending.filter(item => item.roomId === selectedId).map(item => <div className="pending-message" key={item.clientMessageId}><p className="user-content">{item.body}</p><small>{t(item.state === 'sending' ? 'sending' : item.state === 'cancelled' ? 'cancelled' : 'sendFailed')}</small>{item.error && <p className="form-error">{item.error}</p>}<div>{item.state === 'sending' ? <button className="text-button" onClick={() => sendControllers.current.get(item.clientMessageId)?.abort()}>{t('cancelSend')}</button> : <><button className="text-button" onClick={() => void sendPending(item)} disabled={user.suspended}><RefreshCw size={12} />{t('retryMessage')}</button><button className="text-button" onClick={() => setPending(current => current.filter(p => p.clientMessageId !== item.clientMessageId))}>{t('dismissDraft')}</button></>}</div></div>)}
    </div><form className="message-compose" onSubmit={submitMessage}><label className="sr-only" htmlFor="chat-message">{t('messagePlaceholder')}</label><textarea id="chat-message" placeholder={selected.locked ? t('locked') : t('messagePlaceholder')} value={draft} onChange={e => setDraft(e.target.value)} maxLength={2000} rows={2} disabled={selected.locked || user.suspended} onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} /><button className="send-button" aria-label={t('send')} disabled={!draft.trim() || selected.locked || user.suspended}><Send size={20} /></button><p>{pending.length > 0 ? t('draftWarning') : t('chatNotEmergency')}</p></form></>}
    </>}</div></div>{report && <ReportModal target={report} t={t} onClose={() => setReport(null)} onSuccess={onToast} />}</>;
}

function BlockedPanel({ user, t, onAuth, onToast }: Props) {
  const [blocks, setBlocks] = useState<{ userId: string; displayName: string }[]>([]); const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => { if (!user) return; setError(''); try { const data = await api<{ blocks: { userId: string; displayName: string }[] }>('/blocks'); setBlocks(data.blocks); } catch (error) { setError(errorMessage(error)); } finally { setLoading(false); } }, [user?.id]);
  useEffect(() => { void refresh(); }, [refresh]);
  async function unblock(userId: string) { try { await api(`/blocks/${encodeURIComponent(userId)}`, { method: 'DELETE', body: {} }); await refresh(); onToast(t('savedSuccess')); } catch (error) { setError(errorMessage(error)); } }
  if (!user) return <JoinPrompt t={t} onAuth={onAuth} />;
  return <div className="narrow-panel panel"><h2>{t('blocked')}</h2><p className="muted">{t('blockBody')}</p>{error && <ErrorNote message={error} t={t} onRetry={() => void refresh()} />}{loading ? <p>{t('loading')}</p> : blocks.length === 0 ? <EmptyState title={t('noBlocks')} compact /> : <div className="management-list">{blocks.map(block => <div className="management-row" key={block.userId}><Avatar name={block.displayName} /><strong>{block.displayName}</strong><button className="button button-small button-outline" onClick={() => void unblock(block.userId)}>{t('unblock')}</button></div>)}</div>}</div>;
}

function FeedbackPanel({ user, t, onAuth, onToast }: Props) {
  const [category, setCategory] = useState('usability'); const [body, setBody] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [sent, setSent] = useState(false);
  async function submit(event: FormEvent) { event.preventDefault(); setError(''); setBusy(true); try { await api('/feedback', { method: 'POST', body: { category, body } }); setBody(''); setSent(true); onToast(t('feedbackSent')); } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); } }
  if (!user) return <JoinPrompt t={t} onAuth={onAuth} />;
  return <div className="narrow-panel panel"><span className="eyebrow">HELP US GROW</span><h2>{t('feedbackTitle')}</h2><p className="muted">{t('feedbackBody')}</p><form onSubmit={submit} className="form-stack"><label>{t('feedbackCategory')}<select value={category} onChange={e => setCategory(e.target.value)}>{['usability', 'dataIssue', 'bug', 'suggestion'].map(key => <option key={key} value={key}>{t(key)}</option>)}</select></label><label>{t('feedback')}<textarea value={body} onChange={e => { setBody(e.target.value); setSent(false); }} required minLength={3} maxLength={4000} rows={6} /></label>{error && <p className="form-error" role="alert">{error}</p>}{sent && <p className="success-text" role="status"><Check size={16} />{t('feedbackSent')}</p>}<button className="button button-primary" disabled={busy || user.suspended}>{busy ? t('loading') : t('sendFeedback')}<ArrowRight size={17} /></button></form></div>;
}



