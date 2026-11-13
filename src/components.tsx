import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowRight, Bookmark, Check, ChevronRight, Clock3, Compass, ExternalLink, Flag, Info, Leaf, MapPin, Mountain, RefreshCw, ShieldCheck, Sparkles, X } from 'lucide-react';
import { api, errorMessage } from './api';
import { getCourseText, getRecommendationEligibility, hasApprovedTranslations, safeExternalUrl } from './domain';
import { formatDate, type T } from './i18n';
import type { Course, Language, User } from './types';

export function MountainArt({ variant = 0, hero = false }: { variant?: number; hero?: boolean }) {
  const prefix = useId().replaceAll(':', '');
  const palettes = [['#d6e2cf', '#9cbba0', '#537f66', '#315b4c'], ['#ebdcc2', '#b8c1a3', '#748f6e', '#426b56'], ['#dce2df', '#b1c5b6', '#799c88', '#406b58']];
  const colors = palettes[variant % palettes.length];
  return <svg className={hero ? 'mountain-art hero-art' : 'mountain-art'} viewBox="0 0 800 560" fill="none" aria-hidden="true">
    <defs><linearGradient id={`${prefix}-sky`} x1="400" y1="0" x2="400" y2="560" gradientUnits="userSpaceOnUse"><stop stopColor={colors[0]} /><stop offset="1" stopColor="#f0ebd9" /></linearGradient><linearGradient id={`${prefix}-ridge`} x1="0" y1="280" x2="800" y2="540" gradientUnits="userSpaceOnUse"><stop stopColor={colors[2]} /><stop offset="1" stopColor={colors[3]} /></linearGradient></defs>
    <rect width="800" height="560" fill={`url(#${prefix}-sky)`} />
    <circle cx={hero ? '578' : '590'} cy="128" r="67" fill="#f8efd7" />
    <circle cx="578" cy="128" r="98" stroke="#fbf6e6" strokeOpacity=".28" />
    <path d="M0 320 105 255 180 296 310 166 410 282 505 227 645 310 800 228V560H0Z" fill={colors[1]} />
    <path d="M0 395 120 304 193 329 332 245 388 288 451 243 535 345 645 276 800 367V560H0Z" fill={colors[2]} opacity=".74" />
    <path d="M0 390 95 359 166 405 280 309 350 342 431 288 555 420 653 355 800 408V560H0Z" fill={`url(#${prefix}-ridge)`} />
    <path d="M0 488 114 423 225 463 315 417 419 445 519 397 642 452 800 413V560H0Z" fill="#244f40" />
    <path d="M420 560c-83-29-106-55-82-75 26-21 105-16 116-39 10-23-36-42-27-61 5-12 29-21 42-24" stroke="#d6c08e" strokeWidth="7" strokeLinecap="round" opacity=".9" />
    <path d="M420 560c-83-29-106-55-82-75 26-21 105-16 116-39 10-23-36-42-27-61 5-12 29-21 42-24" stroke="#f4e4b8" strokeWidth="2" strokeDasharray="3 9" />
    {[48, 89, 134, 691, 730, 774].map((x, i) => <g key={x} transform={`translate(${x} ${420 + (i % 3) * 19})`} opacity=".8"><path d="M0 0-19 51H19Z" fill="#163f32" /><path d="M0 24-25 77H25Z" fill="#163f32" /><path d="M0 63v30" stroke="#163f32" strokeWidth="5" /></g>)}
    <path d="m172 135 9-4 8 4m20 14 8-4 9 4" stroke="#5c7c67" strokeWidth="2" strokeLinecap="round" />
    {hero && <><path d="M75 74h44M97 52v44" stroke="#6b8e73" strokeOpacity=".4" /><circle cx="683" cy="231" r="4" fill="#d8ba72" /><path d="M55 535h690" stroke="#ece8d7" strokeOpacity=".16" /></>}
  </svg>;
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return <span className="brand"><span className="brand-mark"><Mountain size={24} strokeWidth={1.7} /></span><span className="brand-word">금정산<span>웰컴 트레일</span>{!compact && <small>GEUMJEONGSAN WELCOME TRAIL</small>}</span></span>;
}

export function ErrorNote({ message, onRetry, t }: { message: string; onRetry?: () => void; t: T }) {
  return <div className="notice error-note" role="alert"><Info size={19} /><div><strong>{t('requestFailed')}</strong><p>{message}</p></div>{onRetry && <button className="button button-small button-ghost" onClick={onRetry}><RefreshCw size={15} />{t('retry')}</button>}</div>;
}

export function EmptyState({ title, body, children, compact = false }: { title: string; body?: string; children?: ReactNode; compact?: boolean }) {
  return <div className={`empty-state ${compact ? 'compact' : ''}`}><span className="empty-icon"><Compass size={31} strokeWidth={1.5} /></span><h3>{title}</h3>{body && <p>{body}</p>}{children && <div className="empty-actions">{children}</div>}</div>;
}

export function Modal({ title, onClose, children, t, wide = false }: { title: string; onClose: () => void; children: ReactNode; t: T; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => { const dialog = ref.current; if (dialog && !dialog.open) dialog.showModal(); return () => { if (dialog?.open) dialog.close(); }; }, []);
  return <dialog ref={ref} className={`modal ${wide ? 'modal-wide' : ''}`} aria-labelledby={id} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); } }}>
    <div className="modal-heading"><h2 id={id}>{title}</h2><button className="icon-button" onClick={onClose} aria-label={t('close')}><X size={22} /></button></div>
    {children}
  </dialog>;
}

export function CourseCard({ course, index, t, lang, saved, onSave, onOpen, snapshot = false }: { course: Course; index: number; t: T; lang: Language; saved: boolean; onSave: () => void; onOpen: () => void; snapshot?: boolean }) {
  const eligible = getRecommendationEligibility(course).eligible;
  const text = getCourseText(course, lang);
  return <article className="course-card">
    <div className="course-image"><button className="course-image-link" onClick={onOpen} aria-label={`${text.title} — ${t('view')}`}><MountainArt variant={index} /></button><span className={`image-badge ${course.isFixture ? 'sample-badge' : ''}`}>{course.isFixture ? t('demoBadge') : snapshot ? t('savedSnapshot') : t(course.difficulty)}</span><button className={`bookmark-button ${saved ? 'is-saved' : ''}`} aria-label={`${saved ? t('remove') : t('save')}: ${text.title}`} aria-pressed={saved} onClick={onSave}><Bookmark size={19} fill={saved ? 'currentColor' : 'none'} /></button><span className="image-caption">{t('illustration')}</span></div>
    <div className="course-card-body"><div className="course-themes">{course.themes.slice(0, 3).map(theme => <span key={theme}>{t(theme)}</span>)}</div><button className="text-button card-title" onClick={onOpen}><h3>{text.title}</h3></button><p className="course-summary">{text.summary}</p><div className="course-metrics"><span><Clock3 size={15} />{t('minutes', { count: course.durationMinutes })}</span><span><Mountain size={15} />{t(course.difficulty)}</span></div><div className="card-divider" /><div className="card-bottom"><span className={eligible && !snapshot ? 'approval-dot' : 'muted-status'}><i />{course.isFixture ? t('demoBadge') : snapshot ? t('unknown') : eligible ? t('eligible') : t('unknown')}</span><button className="icon-link" onClick={onOpen} aria-label={`${t('view')}: ${text.title}`}><ArrowRight size={20} /></button></div></div>
  </article>;
}

export function CourseDetail({ course, lang, t, saved, snapshotAt, onSave, onClose, onDiscuss, onPlan }: { course: Course; lang: Language; t: T; saved: boolean; snapshotAt?: string; onSave: () => void; onClose: () => void; onDiscuss: () => void; onPlan?: () => void }) {
  const text = getCourseText(course, lang);
  const sourceUrl = safeExternalUrl(course.sourceUrl);
  const eligibility = getRecommendationEligibility(course);
  const conditionFresh = !!course.conditionValidUntil && Number.isFinite(Date.parse(course.conditionValidUntil)) && Date.parse(course.conditionValidUntil) > Date.now();
  return <Modal title={text.title} onClose={onClose} t={t} wide>
    <div className="detail-art"><MountainArt variant={1} /><span>{t('illustration')}</span></div>
    <div className="detail-content">
      {course.isFixture && <div className="notice sample-notice"><Sparkles size={20} /><div><strong>{t('demoTitle')}</strong><p>{t('demoBody')}</p></div></div>}
      {snapshotAt && <div className="notice"><Info size={20} /><div><strong>{t('savedSnapshot')}</strong><p>{t('savedAt')}: {formatDate(snapshotAt, lang)}</p></div></div>}
      <div className="detail-meta"><span><Clock3 size={17} />{t('minutes', { count: course.durationMinutes })}</span><span><Mountain size={17} />{t(course.difficulty)}</span>{course.themes.map(theme => <span key={theme}><Leaf size={15} />{t(theme)}</span>)}</div>
      <p className="detail-summary">{text.summary}</p><p className="fine-print">{t(lang !== 'ko' && !course.isFixture && !hasApprovedTranslations(course) ? 'translationFallback' : 'contentLanguage')}</p>
      <div className="start-point"><MapPin size={21} /><div><small>{t('startPoint')}</small><strong>{text.startPoint || t('unknown')}</strong></div></div>
      <section className="source-panel"><h3><ShieldCheck size={20} />{t('trust2')}</h3><dl className="source-grid"><div><dt>{t('condition')}</dt><dd>{snapshotAt ? t('unknown') : course.condition === 'closed' ? t('closed') : !conditionFresh ? t('unknown') : t(course.condition)}</dd></div><div><dt>{t('validUntil')}</dt><dd>{formatDate(course.conditionValidUntil, lang)}</dd></div><div><dt>{t('sourceDate')}</dt><dd>{formatDate(course.sourceEffectiveAt, lang)}</dd></div><div><dt>{t('fetchedAt')}</dt><dd>{formatDate(course.fetchedAt, lang)}</dd></div><div><dt>{t('reviewedAt')}</dt><dd>{formatDate(course.reviewedAt, lang)}</dd></div><div><dt>{t('source')}</dt><dd>{sourceUrl ? <a href={sourceUrl} target="_blank" rel="noopener noreferrer">{new URL(sourceUrl).hostname}<ExternalLink size={13} /></a> : t('sourceMissing')}</dd></div></dl>{!eligibility.eligible && <p className="status-line"><Info size={15} />{t('informationOnly')}</p>}<p className="fine-print">{t('infoNotSafety')}</p></section>
      <div className="detail-actions">{onPlan && eligibility.eligible && !snapshotAt && <button className="button button-primary" onClick={onPlan}>{t('jUseCourse')}<ArrowRight size={18} /></button>}<button className={`button ${saved ? 'button-outline' : 'button-primary'}`} onClick={onSave}><Bookmark size={18} fill={saved ? 'currentColor' : 'none'} />{saved ? t('remove') : t('save')}</button><button className="button button-soft" onClick={onDiscuss}>{t('discussion')}<ChevronRight size={18} /></button></div>
    </div>
  </Modal>;
}

export function AuthModal({ t, onClose, onUser }: { t: T; onClose: () => void; onUser: (user: User) => void }) {
  const [register, setRegister] = useState(false);
  const [username, setUsername] = useState(''); const [displayName, setDisplayName] = useState(''); const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setBusy(true);
    try { const result = await api<{ user: User }>(register ? '/auth/register' : '/auth/login', { method: 'POST', body: register ? { username, displayName, password } : { username, password } }); onUser(result.user); onClose(); }
    catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  }
  return <Modal title={t('authTitle')} onClose={onClose} t={t}><div className="auth-content"><div className="auth-emblem"><Mountain size={34} /></div><p className="muted">{t('authBody')}</p><div className="segmented"><button className={!register ? 'selected' : ''} onClick={() => { setRegister(false); setError(''); }}>{t('login')}</button><button className={register ? 'selected' : ''} onClick={() => { setRegister(true); setError(''); }}>{t('register')}</button></div><form onSubmit={submit} className="form-stack"><label>{t('username')}<input autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} required minLength={3} maxLength={32} pattern="[a-zA-Z0-9_.-]+" /><small>{t('usernameHint')}</small></label>{register && <label>{t('displayName')}<input autoComplete="nickname" value={displayName} onChange={e => setDisplayName(e.target.value)} required maxLength={50} /></label>}<label>{t('password')}<input type="password" autoComplete={register ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} required minLength={12} maxLength={128} /><small>{t('passwordHint')}</small></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="button button-primary button-full" disabled={busy}>{busy ? t('loading') : t(register ? 'register' : 'login')}<ArrowRight size={17} /></button></form><p className="fine-print">{t('privacyHint')}</p></div></Modal>;
}

export function ReportModal({ target, t, onClose, onSuccess }: { target: { targetType: 'message' | 'post' | 'comment'; targetId: string }; t: T; onClose: () => void; onSuccess: (text: string) => void }) {
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setError(''); try { await api('/reports', { method: 'POST', body: { ...target, reason } }); onSuccess(t('reportSent')); onClose(); } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); } }
  return <Modal title={t('reportTitle')} t={t} onClose={onClose}><form onSubmit={submit} className="modal-form form-stack"><p>{t('reportHint')}</p><label>{t('reason')}<textarea value={reason} onChange={e => setReason(e.target.value)} required minLength={3} maxLength={1000} rows={4} /></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="button button-primary" disabled={busy}><Flag size={17} />{busy ? t('loading') : t('submitReport')}</button></form></Modal>;
}

export function Toast({ text }: { text: string }) { return <div className="toast" role="status"><Check size={18} />{text}</div>; }



