import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Activity, BookOpen, Check, ClipboardList, FileCheck2, Flag, History, Info, LockKeyhole, MessageSquare, Plus, RefreshCw, Save, ShieldCheck, Users } from 'lucide-react';
import { ApiError, api, errorMessage } from './api';
import { EmptyState, ErrorNote, Modal } from './components';
import { formatDate, type T } from './i18n';
import type { AuditEntry, Course, CourseText, Feedback, Language, Report, Room, User } from './types';

type Props = { user: User; lang: Language; t: T; onToast: (text: string) => void; onCoursesChanged: () => void };
type Overview = { counts: Record<'users' | 'courses' | 'reports' | 'openReports' | 'messages', number | null>; contentMode: string; capabilities: string[] };
type Tab = 'overview' | 'content' | 'reports' | 'members' | 'rooms' | 'audit' | 'feedback';

export default function Admin(props: Props) {
  const { t } = props; const [overview, setOverview] = useState<Overview | null>(null); const [tab, setTab] = useState<Tab>('overview'); const [error, setError] = useState('');
  const refresh = useCallback(async () => { try { setOverview(await api<Overview>('/admin/overview')); setError(''); } catch (error) { setOverview(null); setError(errorMessage(error)); } }, []);
  useEffect(() => { void refresh(); }, [refresh, props.user.id]);
  useEffect(() => { if (tab === 'overview') void refresh(); }, [tab, refresh]);
  const caps = overview?.capabilities ?? [];
  const tabs: { key: Tab; icon: typeof Activity; allowed: boolean }[] = [{ key: 'overview', icon: Activity, allowed: true }, { key: 'content', icon: BookOpen, allowed: caps.includes('content') }, { key: 'reports', icon: Flag, allowed: caps.includes('moderation') }, { key: 'members', icon: Users, allowed: caps.includes('moderation') }, { key: 'rooms', icon: MessageSquare, allowed: caps.includes('moderation') }, { key: 'audit', icon: History, allowed: caps.includes('audit') }, { key: 'feedback', icon: ClipboardList, allowed: caps.includes('feedback') }];
  return <section className="page-shell admin-page"><div className="page-intro"><span className="eyebrow">CONTENT & COMMUNITY CARE</span><h1>{t('adminTitle')}</h1><p>{t('adminBody')}</p></div><div className="admin-notice"><ShieldCheck size={20} /><p>{t('permissionServer')}</p></div>{error && <ErrorNote message={error} t={t} onRetry={() => void refresh()} />}
    <div className="section-tabs" role="tablist" aria-label={t('admin')}>{tabs.filter(item => item.allowed).map(({ key, icon: Icon }) => <button key={key} role="tab" aria-selected={key === tab} className={tab === key ? 'selected' : ''} onClick={() => setTab(key)}><Icon size={17} />{t(key)}</button>)}</div>
    {!overview && !error && <p className="loading-line">{t('loading')}</p>}
    {overview && tab === 'overview' && <><div className="admin-stats">{([['users', 'usersCount', Users], ['courses', 'coursesCount', BookOpen], ['openReports', 'openReports', Flag], ['messages', 'messagesCount', MessageSquare]] as const).filter(([key]) => overview.counts[key] !== null).map(([key, label, Icon]) => <div className="stat-card" key={key}><Icon size={23} /><strong>{overview.counts[key]}</strong><span>{t(label)}</span></div>)}</div><div className="panel overview-note"><FileCheck2 size={29} /><div><h2>{t('trust2')}</h2><p>{t('approvalBody')}</p><p>{t('localNotice')}</p></div><button className="button button-outline" onClick={() => void refresh()}><RefreshCw size={17} />{t('refresh')}</button></div></>}
    {overview && tab === 'content' && caps.includes('content') && <ContentAdmin {...props} />}
    {overview && tab === 'reports' && caps.includes('moderation') && <ReportsAdmin {...props} />}
    {overview && tab === 'members' && caps.includes('moderation') && <MembersAdmin {...props} />}
    {overview && tab === 'rooms' && caps.includes('moderation') && <RoomsAdmin {...props} />}
    {overview && tab === 'audit' && caps.includes('audit') && <AuditAdmin {...props} />}
    {overview && tab === 'feedback' && caps.includes('feedback') && <FeedbackAdmin {...props} />}
  </section>;
}

function useAdminData<TData>(path: string) {
  const [data, setData] = useState<TData | null>(null); const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => { setError(''); try { setData(await api<TData>(path)); } catch (error) { setData(null); setError(errorMessage(error)); } finally { setLoading(false); } }, [path]);
  useEffect(() => { void refresh(); }, [refresh]);
  return { data, error, loading, refresh };
}

function DataSection({ title, loading, error, refresh, t, children, action }: { title: string; loading: boolean; error: string; refresh: () => Promise<void>; t: T; children: ReactNode; action?: ReactNode }) {
  return <div><div className="section-toolbar"><h2>{title}</h2><div className="toolbar-actions">{action}<button className="icon-button" onClick={() => void refresh()} aria-label={t('refresh')}><RefreshCw size={18} /></button></div></div>{error && <ErrorNote message={error} t={t} onRetry={() => void refresh()} />}{loading ? <p className="loading-line">{t('loading')}</p> : children}</div>;
}

function ContentAdmin(props: Props) {
  const { t, lang, onCoursesChanged } = props; const state = useAdminData<{ courses: Course[] }>('/admin/courses'); const [editing, setEditing] = useState<Course | 'new' | null>(null);
  async function saved(course: Course) { setEditing(course); await state.refresh(); onCoursesChanged(); }
  return <DataSection title={t('content')} {...state} t={t} action={<button className="button button-primary button-small" onClick={() => setEditing('new')}><Plus size={16} />{t('createCourse')}</button>}>
    {state.data?.courses.length === 0 && <EmptyState title={t('noItems')} />}
    <div className="admin-course-grid">{state.data?.courses.map(course => <article className="admin-course-card" key={course.id}><div className="item-meta"><span className={`status-tag ${course.status}`}>{t(course.status)}</span><span>v{course.version}</span></div><h3>{course.title}</h3><p>{course.summary}</p><dl><div><dt>{t('condition')}</dt><dd>{t(course.condition)}</dd></div><div><dt>{t('reviewedAt')}</dt><dd>{formatDate(course.reviewedAt, lang)}</dd></div></dl><button className="button button-outline button-full" onClick={() => setEditing(course)}>{t('edit')}</button></article>)}</div>
    {editing && <CourseEditor key={editing === 'new' ? 'new' : `${editing.id}:${editing.version}`} course={editing === 'new' ? undefined : editing} {...props} onClose={() => setEditing(null)} onSaved={saved} />}
  </DataSection>;
}

function toDateInput(value: string | null | undefined): string {
  if (!value || !Number.isFinite(Date.parse(value))) return '';
  const date = new Date(value); const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60000); return adjusted.toISOString().slice(0, 16);
}
function isoFromInput(value: string): string | null { return value ? new Date(value).toISOString() : null; }
function preserveDateInput(value: string, original: string | null | undefined): string | null { return value === toDateInput(original) ? original ?? null : isoFromInput(value); }
function translationDraft(course?: Course): Record<'en' | 'zh-TW', CourseText> { return { en: { title: course?.translations?.en?.title ?? '', summary: course?.translations?.en?.summary ?? '', startPoint: course?.translations?.en?.startPoint ?? '' }, 'zh-TW': { title: course?.translations?.['zh-TW']?.title ?? '', summary: course?.translations?.['zh-TW']?.summary ?? '', startPoint: course?.translations?.['zh-TW']?.startPoint ?? '' } }; }
function CourseEditor({ course, t, lang, onToast, onClose, onSaved }: Props & { course?: Course; onClose: () => void; onSaved: (course: Course) => Promise<void> }) {
  const [title, setTitle] = useState(course?.title ?? ''); const [summary, setSummary] = useState(course?.summary ?? ''); const [durationMinutes, setDuration] = useState(course?.durationMinutes ?? 60); const [difficulty, setDifficulty] = useState<Course['difficulty']>(course?.difficulty ?? 'easy'); const [themes, setThemes] = useState(course?.themes ?? ['nature']); const [startPoint, setStartPoint] = useState(course?.startPoint ?? ''); const [sourceUrl, setSourceUrl] = useState(course?.sourceUrl ?? ''); const [sourceEffectiveAt, setSourceEffectiveAt] = useState(toDateInput(course?.sourceEffectiveAt)); const [fetchedAt, setFetchedAt] = useState(toDateInput(course?.fetchedAt)); const [condition, setCondition] = useState<Course['condition']>(course?.condition ?? 'unknown'); const [conditionValidUntil, setConditionValidUntil] = useState(toDateInput(course?.conditionValidUntil)); const [translationApproved, setTranslationApproved] = useState(course?.translationStatus === 'approved'); const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const factsChanged = !!course && (title !== course.title || summary !== course.summary || durationMinutes !== course.durationMinutes || difficulty !== course.difficulty || JSON.stringify(themes) !== JSON.stringify(course.themes) || startPoint !== course.startPoint || sourceUrl !== course.sourceUrl || sourceEffectiveAt !== toDateInput(course.sourceEffectiveAt));
  const [translations, setTranslations] = useState(() => translationDraft(course));
  const translationsChanged = JSON.stringify(translations) !== JSON.stringify(translationDraft(course));
  async function submit(action: 'draft' | 'approve' | 'withdraw') {
    setError(''); if (reason.trim().length < 3) { setError(t('actionReason')); return; }
    if (action === 'approve' && (!course || factsChanged || translationsChanged)) { setError(t('saveBeforeApproval')); return; }
    if (action === 'approve' && (!translationApproved || !sourceUrl.trim() || !fetchedAt)) { setError(t('approvalRequirements')); return; }
    setBusy(true);
    try {
      const payload = action === 'withdraw' ? { status: 'withdrawn', reason, version: course?.version } : {
        title, summary, durationMinutes, difficulty, themes, startPoint, sourceUrl,
        sourceEffectiveAt: preserveDateInput(sourceEffectiveAt, course?.sourceEffectiveAt), fetchedAt: preserveDateInput(fetchedAt, course?.fetchedAt),
        condition, conditionValidUntil: preserveDateInput(conditionValidUntil, course?.conditionValidUntil), translations,
        translationStatus: translationApproved ? 'approved' : 'pending',
        status: action === 'approve' ? 'published' : 'draft', approve: action === 'approve',
        reason, ...(course ? { version: course.version } : {}),
      };
      const result = await api<{ course: Course }>(course ? `/admin/courses/${encodeURIComponent(course.id)}` : '/admin/courses', { method: course ? 'PATCH' : 'POST', body: payload });
      onToast(t('savedSuccess')); await onSaved(result.course);
    } catch (error) { setError(error instanceof ApiError && error.status === 409 && error.code !== 'content_changed_review_required' ? t('staleConflict') : errorMessage(error)); } finally { setBusy(false); }
  }
  return <Modal title={course ? t('edit') : t('newCourse')} onClose={onClose} t={t} wide><form className="modal-form form-stack" onSubmit={event => { event.preventDefault(); void submit('draft'); }}>
    <div className="notice"><Info size={19} /><div><strong>{t('approvalWorkflow')}</strong><p>{t('approvalBody')}</p></div></div>
    <h3 className="form-section-title">{t('baseContent')}</h3><label>{t('postTitle')}<input value={title} onChange={e => setTitle(e.target.value)} maxLength={120} required /></label><label>{t('summary')}<textarea value={summary} onChange={e => setSummary(e.target.value)} required maxLength={4000} rows={3} /></label>
    <div className="form-grid"><label>{t('duration')} · min<input type="number" min={1} max={1440} value={durationMinutes} onChange={e => setDuration(Number(e.target.value))} required /></label><label>{t('difficulty')}<select value={difficulty} onChange={e => setDifficulty(e.target.value as Course['difficulty'])}>{['easy', 'moderate', 'hard'].map(value => <option key={value} value={value}>{t(value)}</option>)}</select></label></div>
    <fieldset className="theme-field"><legend>{t('theme')}</legend>{['nature', 'culture', 'views'].map(theme => <label key={theme}><input type="checkbox" checked={themes.includes(theme)} onChange={e => setThemes(current => e.target.checked ? [...current, theme] : current.filter(value => value !== theme))} />{t(theme)}</label>)}</fieldset>
    <label>{t('startPoint')}<input value={startPoint} onChange={e => setStartPoint(e.target.value)} maxLength={200} required /></label><label>{t('sourceRequired')}<input type="url" placeholder="https://…" value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} maxLength={2000} /></label>
    <div className="form-grid"><label>{t('sourceDate')}<input type="datetime-local" value={sourceEffectiveAt} onChange={e => setSourceEffectiveAt(e.target.value)} /></label><label>{t('fetchedAt')}<input type="datetime-local" value={fetchedAt} onChange={e => setFetchedAt(e.target.value)} /></label><label>{t('condition')}<select value={condition} onChange={e => setCondition(e.target.value as Course['condition'])}>{['unknown', 'open', 'closed'].map(value => <option key={value} value={value}>{t(value)}</option>)}</select></label><label>{t('validUntil')}<input type="datetime-local" value={conditionValidUntil} onChange={e => setConditionValidUntil(e.target.value)} /></label></div>
    <section className="translation-editor"><h3 className="form-section-title">{t('translationFields')}</h3><p className="fine-print">{t('translationReviewHint')}</p>{(['en', 'zh-TW'] as const).map(locale => <fieldset className="translation-field form-stack" key={locale}><legend>{locale === 'en' ? 'English' : '繁體中文'}</legend><label>{t('postTitle')}<input value={translations[locale].title} maxLength={120} onChange={e => setTranslations(current => ({ ...current, [locale]: { ...current[locale], title: e.target.value } }))} /></label><label>{t('summary')}<textarea value={translations[locale].summary} maxLength={4000} rows={3} onChange={e => setTranslations(current => ({ ...current, [locale]: { ...current[locale], summary: e.target.value } }))} /></label><label>{t('startPoint')}<input value={translations[locale].startPoint} maxLength={200} onChange={e => setTranslations(current => ({ ...current, [locale]: { ...current[locale], startPoint: e.target.value } }))} /></label></fieldset>)}</section>
    <label className="check-row"><input type="checkbox" checked={translationApproved} onChange={e => setTranslationApproved(e.target.checked)} /><span>{t('translationApproved')}</span></label>
    {course?.reviewedAt && <p className="fine-print">{t('reviewedAt')}: {formatDate(course.reviewedAt, lang)} · v{course.version}</p>}
    <label>{t('reviewReason')}<textarea value={reason} onChange={e => setReason(e.target.value)} minLength={3} maxLength={1000} required rows={2} /></label>{error && <p className="form-error" role="alert">{error}</p>}
    <div className="editor-actions"><button className="button button-outline" disabled={busy}><Save size={17} />{t('saveDraft')}</button><button type="button" className="button button-primary" onClick={event => { if (event.currentTarget.form?.reportValidity()) void submit('approve'); }} disabled={busy || !course || factsChanged || translationsChanged}><FileCheck2 size={17} />{t('approvePublish')}</button>{course && course.status !== 'withdrawn' && <button type="button" className="button button-danger" disabled={busy} onClick={() => void submit('withdraw')}>{t('withdraw')}</button>}</div>{(!course || factsChanged || translationsChanged) && <p className="fine-print">{t('saveBeforeApproval')}</p>}
  </form></Modal>;
}

type AdminAction = { title: string; detail?: string; execute: (reason: string) => Promise<unknown> };
function ActionModal({ action, t, onClose, onDone }: { action: AdminAction; t: T; onClose: () => void; onDone: () => Promise<void> }) {
  const [reason, setReason] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) { event.preventDefault(); setError(''); setBusy(true); try { await action.execute(reason); await onDone(); onClose(); } catch (error) { setError(error instanceof ApiError && error.status === 409 ? t('staleConflict') : errorMessage(error)); } finally { setBusy(false); } }
  return <Modal title={action.title} onClose={onClose} t={t}><form className="modal-form form-stack" onSubmit={submit}>{action.detail && <p className="user-content action-detail">{action.detail}</p>}<label>{t('reason')}<textarea value={reason} onChange={e => setReason(e.target.value)} required minLength={3} maxLength={1000} rows={3} /></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="button button-primary" disabled={busy}>{busy ? t('loading') : t('confirmAction')}<Check size={17} /></button></form></Modal>;
}

function ReportsAdmin({ t, lang, onToast }: Props) {
  const state = useAdminData<{ reports: Report[] }>('/admin/reports'); const [action, setAction] = useState<AdminAction | null>(null);
  function resolve(report: Report, value: 'hide' | 'restore' | 'dismiss') { setAction({ title: t(value), detail: report.targetPreview, execute: reason => api(`/admin/reports/${encodeURIComponent(report.id)}/resolve`, { method: 'POST', body: { action: value, reason, version: report.version } }) }); }
  return <DataSection title={t('reports')} {...state} t={t}>{state.data?.reports.length === 0 && <EmptyState title={t('noItems')} />}
    <div className="management-cards">{state.data?.reports.map(report => <article className="panel report-card" key={report.id}><div className="item-meta"><span className="status-tag">{report.status}</span><span>{formatDate(report.createdAt, lang)}</span></div><h3>{report.reason}</h3><p className="fine-print">{report.targetType} · {report.authorName || report.targetId}</p>{report.targetPreview && <blockquote className="user-content">{report.targetPreview}</blockquote>}<div className="toolbar-actions"><button className="button button-small button-danger" onClick={() => resolve(report, 'hide')}>{t('hide')}</button><button className="button button-small button-outline" onClick={() => resolve(report, 'restore')}>{t('restore')}</button><button className="button button-small button-ghost" onClick={() => resolve(report, 'dismiss')}>{t('dismiss')}</button></div></article>)}</div>
    {action && <ActionModal action={action} t={t} onClose={() => setAction(null)} onDone={async () => { onToast(t('savedSuccess')); await state.refresh(); }} />}</DataSection>;
}

function MembersAdmin({ user, t, onToast }: Props) {
  const state = useAdminData<{ users: User[] }>('/admin/users'); const [action, setAction] = useState<AdminAction | null>(null);
  const roles: Record<User['role'], string> = { member: 'roleMember', content: 'roleContent', moderator: 'roleModerator', admin: 'roleAdmin' };
  return <DataSection title={t('members')} {...state} t={t}><div className="panel management-list">{state.data?.users.map(member => <div className="management-row" key={member.id}><span className="avatar">{member.displayName.slice(0, 1)}</span><div><strong>{member.displayName}</strong><small>@{member.username} · {t(roles[member.role])}</small></div><span className={`status-tag ${member.suspended ? 'withdrawn' : 'published'}`}>{t(member.suspended ? 'suspended' : 'active')}</span>{member.id !== user.id && member.role !== 'admin' && <button className={`button button-small ${member.suspended ? 'button-outline' : 'button-danger'}`} onClick={() => setAction({ title: t(member.suspended ? 'unsuspend' : 'suspend'), detail: member.displayName, execute: reason => api(`/admin/users/${encodeURIComponent(member.id)}`, { method: 'PATCH', body: { suspended: !member.suspended, reason, version: member.version } }) })}>{t(member.suspended ? 'unsuspend' : 'suspend')}</button>}</div>)}</div>{action && <ActionModal action={action} t={t} onClose={() => setAction(null)} onDone={async () => { onToast(t('savedSuccess')); await state.refresh(); }} />}</DataSection>;
}

function RoomsAdmin({ t, onToast }: Props) {
  const state = useAdminData<{ rooms: Room[] }>('/rooms'); const [action, setAction] = useState<AdminAction | null>(null);
  return <DataSection title={t('rooms')} {...state} t={t}><div className="management-cards">{state.data?.rooms.map(room => <article className="panel room-admin-card" key={room.id}><LockKeyhole size={22} /><div><h3>{room.name}</h3><p>{room.description}</p><span className="status-tag">{t(room.locked ? 'locked' : 'active')}</span></div><button className="button button-outline" onClick={() => setAction({ title: t(room.locked ? 'unlock' : 'lock'), detail: room.name, execute: reason => api(`/admin/rooms/${encodeURIComponent(room.id)}/lock`, { method: 'POST', body: { locked: !room.locked, reason, version: room.version } }) })}>{t(room.locked ? 'unlock' : 'lock')}</button></article>)}</div>{action && <ActionModal action={action} t={t} onClose={() => setAction(null)} onDone={async () => { onToast(t('savedSuccess')); await state.refresh(); }} />}</DataSection>;
}

function AuditAdmin({ t, lang }: Props) {
  const state = useAdminData<{ entries: AuditEntry[] }>('/admin/audit');
  return <DataSection title={t('audit')} {...state} t={t}>{state.data?.entries.length === 0 ? <EmptyState title={t('auditEmpty')} /> : <div className="table-wrap panel"><table className="data-table"><thead><tr><th>{t('date')}</th><th>{t('action')}</th><th>{t('actor')}</th><th>{t('target')}</th><th>{t('reason')}</th></tr></thead><tbody>{state.data?.entries.map(entry => <tr key={entry.id}><td>{formatDate(entry.createdAt, lang)}</td><td>{entry.action}</td><td><code>{entry.actorId}</code></td><td><code>{entry.targetId}</code></td><td>{entry.reason}</td></tr>)}</tbody></table></div>}</DataSection>;
}

function FeedbackAdmin({ t, lang }: Props) {
  const state = useAdminData<{ feedback: Feedback[] }>('/admin/feedback');
  return <DataSection title={t('feedback')} {...state} t={t}>{state.data?.feedback.length === 0 && <EmptyState title={t('noItems')} />}<div className="management-cards">{state.data?.feedback.map(item => <article className="panel" key={item.id}><div className="item-meta"><span className="status-tag">{t(item.category)}</span><time>{formatDate(item.createdAt, lang)}</time></div><p className="user-content">{item.body}</p><small className="muted">{item.authorName ?? item.authorId ?? item.userId}</small></article>)}</div></DataSection>;
}

