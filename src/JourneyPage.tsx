import { useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Bookmark, Bus, ChevronRight, CloudSun, Compass, ExternalLink, FileDown, Leaf, Mountain, RotateCcw, Route, ShieldCheck, TrainFront, Users } from 'lucide-react';
import { ErrorNote, Modal } from './components';
import { getCourseText, isCourseEligible } from './domain';
import { checkKeys, currentChecks, origins, preferenceLines, resolveJourneyCourse, reviseJourney, type CheckKey, type JourneyDraft } from './journey';
import { formatDate, type T } from './i18n';
import type { Course, Language, QuizAnswers } from './types';

export const officialSources = [
  { key: 'jPark', url: 'https://www.knps.or.kr/front/portal/visit/visitCourseMain.do?menuNo=7020102&parkId=122800', icon: Mountain },
  { key: 'jWeather', url: 'https://www.weather.go.kr/w/index.do', icon: CloudSun },
  { key: 'jBus', url: 'https://bus.busan.go.kr/busanBIMS/mobile/webApp/page/main/main.asp', icon: Bus },
  { key: 'jMetro', url: 'https://www.humetro.busan.kr/', icon: TrainFront },
];

export function SourceLinks({ t, compact = false }: { t: T; compact?: boolean }) {
  return <section className={`journey-sources ${compact ? 'sources-compact' : ''}`} aria-label={t('jSourcesTitle')}>
    <h3>{t('jSourcesTitle')}</h3><p>{t('jSourcesBody')}</p>
    <div className="source-links">{officialSources.map(({ key, url, icon: Icon }) => <a key={key} href={url} target="_blank" rel="noopener noreferrer"><Icon size={19} /><span>{t(key)}<small>{t('jSourceHint')}</small></span><ExternalLink size={14} /></a>)}</div>
    <p className="fine-print">{t('jSourceDate')}</p>
  </section>;
}

export function JourneyBridge({ t, onStart }: { t: T; onStart: () => void }) {
  return <section className="journey-bridge page-width"><div><span className="eyebrow">BEFORE · DURING · AFTER</span><h2>{t('jBridgeTitle')}</h2><p>{t('jBridgeBody')}</p></div><button className="button button-primary" onClick={onStart}>{t('jStart')}<ArrowRight size={18} /></button></section>;
}

export function VisitHelp({ t }: { t: T }) {
  return <section className="visit-help page-width"><SourceLinks t={t} /><div className="visit-faq"><span className="eyebrow">A LITTLE HELP</span><h2>{t('jFAQ')}</h2>{[1, 2, 3].map(n => <details key={n}><summary>{t(`jFaqQ${n}`)}<ChevronRight size={16} /></summary><p>{t(`jFaqA${n}`)}</p></details>)}</div></section>;
}

export function PreferenceCard({ answers, t, onToast }: { answers: QuizAnswers; t: T; onToast: (message: string) => void }) {
  const lines = preferenceLines(answers, t);
  const content = lines.join('\n');
  async function copy() {
    try { await navigator.clipboard.writeText(content); onToast(t('jCopied')); }
    catch { onToast(t('jCopyError')); }
  }
  function download() {
    try {
      const url = URL.createObjectURL(new Blob(['\uFEFF', content], { type: 'text/plain;charset=utf-8' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'geumjeongsan-walking-preferences.txt';
      document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); onToast(t('jDownloaded'));
    } catch { onToast(t('jDownloadError')); }
  }
  return <section className="preference-section"><div className="preference-card"><Mountain size={27} strokeWidth={1.4} /><span className="eyebrow">GEUMJEONGSAN WELCOME TRAIL</span><h3>{t('jPreferenceTitle')}</h3><div>{[answers.time, answers.experience, answers.interest, answers.pace].map((value, index) => <span key={index}>{t(value)}</span>)}</div><p>{t('jCardCaution')}</p></div><div className="preference-actions"><h3>{t('jPreferenceTitle')}</h3><p>{t('jPreferenceBody')}</p><div className="toolbar-actions"><button className="button button-outline" onClick={() => void copy()}>{t('jCopy')}</button><button className="button button-primary" onClick={download}><FileDown size={17} />{t('jDownload')}</button></div></div></section>;
}

type Props = {
  t: T; lang: Language; draft: JourneyDraft; courses: Course[]; loading: boolean; error: string; online: boolean;
  onChange: (draft: JourneyDraft) => void; onSave: () => void; onClear: () => boolean;
  onExplore: () => void; onCommunity: () => void; onRetry: () => void;
};
export default function Journey({ t, lang, draft, courses, loading, error, online, onChange, onSave, onClear, onExplore, onCommunity, onRetry }: Props) {
  const [step, setStep] = useState(0);
  const [confirmClear, setConfirmClear] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const available = online && !loading && !error ? courses.filter(course => isCourseEligible(course)) : [];
  const course = resolveJourneyCourse(draft, available);
  const checked = currentChecks(draft);
  const steps = [t('jStep1'), t('jStep2'), t('jStep3'), t('jStep4')];
  const icons = [Compass, Users, Leaf, ShieldCheck];
  function go(next: number) { setStep(next); requestAnimationFrame(() => { heading.current?.focus(); heading.current?.scrollIntoView({ block: 'nearest', behavior: 'auto' }); }); }
  function revise(changes: Parameters<typeof reviseJourney>[1]) { onChange(reviseJourney(draft, changes)); }
  function check(key: CheckKey, enabled: boolean) { onChange({ ...draft, savedAt: null, checks: { ...draft.checks, [key]: enabled ? new Date().toISOString() : '' } }); }
  const renderCheck = (key: CheckKey) => <label className={`journey-check ${checked.includes(key) ? 'is-checked' : ''}`} key={key}><input type="checkbox" checked={checked.includes(key)} onChange={event => check(key, event.target.checked)} /><span>{t(`jCheck_${key}`)}</span></label>;
  const selectedTitle = course ? getCourseText(course, lang).title : t('jNoCourse');
  const StepIcon = icons[step];
  return <section className="page-shell journey-page"><div className="page-intro"><span className="eyebrow">{t('jEyebrow')}</span><h1>{t('jTitle')}</h1><p>{t('jIntro')}</p></div>
    <nav className="journey-steps" aria-label={t('journey')}>{steps.map((title, index) => <button key={title} aria-current={step === index ? 'step' : undefined} className={step === index ? 'selected' : ''} onClick={() => go(index)}><span>0{index + 1}</span><strong>{title}</strong><ChevronRight size={15} /></button>)}</nav>
    <div className="journey-layout"><div className="journey-main"><div className="journey-panel"><div className="journey-panel-heading"><span><StepIcon size={24} strokeWidth={1.5} /></span><div><small>0{step + 1} / 04</small><h2 ref={heading} tabIndex={-1}>{steps[step]}</h2></div></div>
      {step === 0 && <div className="form-stack journey-fields">
        {error && <ErrorNote message={error} t={t} onRetry={onRetry} />}
        {draft.courseId && !course && !loading && <div className="notice sample-notice" role="status"><ShieldCheck size={19} /><p>{t('jStale')}</p></div>}
        <label>{t('jCourse')}<select value={course?.id ?? ''} onChange={event => { const chosen = available.find(item => item.id === event.target.value); revise({ courseId: chosen?.id ?? '', courseVersion: chosen?.version ?? 0 }); }} disabled={loading}><option value="">{t('jNoCourse')}</option>{available.map(item => <option key={item.id} value={item.id}>{getCourseText(item, lang).title}</option>)}</select></label>
        {loading ? <p role="status">{t('loading')}</p> : !error && available.length === 0 && <div className="journey-empty"><Compass size={24} /><p>{t('jUnavailable')}</p><button className="text-button" onClick={onExplore}>{t('jChooseCourse')}<ArrowRight size={16} /></button></div>}
        <div className="journey-field-row"><label>{t('jDate')}<input type="date" value={draft.date} onChange={event => revise({ date: event.target.value })} /></label><label>{t('jOrigin')}<select value={draft.origin} onChange={event => revise({ origin: event.target.value as JourneyDraft['origin'] })}><option value="">{t('jSelect')}</option>{origins.map(origin => <option key={origin} value={origin}>{t(`jOrigin_${origin}`)}</option>)}</select></label></div><p className="fine-print">{t('jOriginHint')}</p>
      </div>}
      {step === 1 && <div className="journey-fields form-stack"><h3>{t('jArrivalTitle')}</h3><p className="muted">{t('jArrivalBody')}</p><label>{t('jMeeting')}<textarea rows={3} maxLength={240} value={draft.meeting} placeholder={t('jMeetingHint')} onChange={event => revise({ meeting: event.target.value })} /></label><p className="fine-print">{t('jUnverifiedNote')}</p>{renderCheck('arrival')}{renderCheck('meeting')}<div className="journey-discuss"><Users size={22} /><div><strong>{t('jDiscuss')}</strong><p>{t('jDiscussBody')}</p><button className="button button-outline" onClick={onCommunity}>{t('community')}<ArrowRight size={15} /></button></div></div></div>}
      {step === 2 && <div className="journey-fields form-stack"><div className="journey-rest"><Leaf size={27} strokeWidth={1.3} /><h3>{t('jRestTitle')}</h3><p>{t('jRestBody')}</p></div><label>{t('jReturnBy')}<input type="time" value={draft.returnBy} onChange={event => revise({ returnBy: event.target.value })} /><small>{t('jTimeHint')}</small></label><label>{t('jReturnNote')}<textarea rows={3} maxLength={240} value={draft.returnNote} placeholder={t('jReturnHint')} onChange={event => revise({ returnNote: event.target.value })} /></label><p className="fine-print">{t('jUnverifiedNote')}</p>{renderCheck('return')}</div>}
      {step === 3 && <div className="journey-fields"><h3>{t('jChecklistTitle')}</h3><p className="muted">{t('jChecklistBody')}</p><div className="journey-checklist">{checkKeys.map(renderCheck)}</div><div className="journey-progress"><span>{t('jProgress', { count: checked.length })}</span><progress max={5} value={checked.length} /></div><p className="fine-print">{t('jLocalBody')}</p></div>}
      <div className="journey-step-actions"><button className="button button-ghost" disabled={step === 0} onClick={() => go(step - 1)}><ArrowLeft size={17} />{t('back')}</button>{step < 3 ? <button className="button button-primary" onClick={() => go(step + 1)}>{t('next')}<ArrowRight size={17} /></button> : <button className="button button-primary" onClick={onSave}><Bookmark size={17} />{t('jSave')}</button>}</div>
    </div><SourceLinks t={t} compact /></div>
    <aside className="journey-summary"><div className="summary-top"><Route size={25} strokeWidth={1.4} /><span>MY GEUMJEONGSAN</span></div><h2>{t('jSummary')}</h2><div className="journey-status"><ShieldCheck size={16} />{t(course ? 'jRouteSelected' : 'jNoGuidance')}</div><ol className="summary-timeline"><li><span>01</span><div><small>{t('jCourse')}</small><strong>{selectedTitle}</strong>{course && <small>{t('validUntil')}: {formatDate(course.conditionValidUntil, lang)}</small>}</div></li><li><span>02</span><div><small>{t('jOrigin')}</small><strong>{draft.origin ? t(`jOrigin_${draft.origin}`) : t('jSelect')}</strong><small>{draft.date || t('jDate')}</small></div></li><li><span>03</span><div><small>{t('jMeeting')}</small><strong>{draft.meeting || t('jSelect')}</strong></div></li><li><span>04</span><div><small>{t('jReturnBy')}</small><strong>{draft.returnBy || t('jSelect')}</strong>{draft.returnNote && <small className="user-content">{draft.returnNote}</small>}</div></li></ol><p className="summary-caption">{t('jUnverifiedNote')}</p><p className="summary-progress">{t('jProgress', { count: checked.length })}</p><button className="button button-primary button-full" onClick={onSave}><Bookmark size={17} />{t('jSave')}</button><p className="summary-saved" role="status">{draft.savedAt ? `${t('jSavedAt')}: ${formatDate(draft.savedAt, lang)}` : t('jUnsaved')}</p><button className="text-button" onClick={() => setConfirmClear(true)}><RotateCcw size={14} />{t('jClear')}</button><p className="fine-print">{t('jLocal')}</p></aside></div>
    {confirmClear && <Modal title={t('jClearTitle')} t={t} onClose={() => setConfirmClear(false)}><div className="modal-form"><p>{t('jClearBody')}</p><div className="toolbar-actions"><button className="button button-outline" onClick={() => setConfirmClear(false)}>{t('cancel')}</button><button className="button button-danger" onClick={() => { if (onClear()) { setConfirmClear(false); go(0); } }}>{t('jClear')}</button></div></div></Modal>}
  </section>;
}
