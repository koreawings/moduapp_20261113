import test from 'node:test';
import assert from 'node:assert/strict';
import { getRecommendationEligibility, recommendCourses, safeExternalUrl, defaultAnswers } from '../src/domain.ts';
const now=Date.parse('2026-11-01T00:00:00Z');
const approved={id:'test-approved',title:'Synthetic eligibility case',summary:'Not route guidance',durationMinutes:60,difficulty:'easy',themes:['nature'],startPoint:'Test only',sourceUrl:'https://example.org/evidence',sourceEffectiveAt:'2026-10-31T00:00:00Z',fetchedAt:'2026-10-31T01:00:00Z',reviewedAt:'2026-10-31T02:00:00Z',reviewer:null,reviewed:true,status:'published',condition:'open',conditionValidUntil:'2026-11-02T00:00:00Z',translationStatus:'approved',sourceFingerprint:'a'.repeat(64),translationSourceFingerprint:'a'.repeat(64),translations:{en:{title:'Synthetic course',summary:'Not route guidance',startPoint:'Test only'},'zh-TW':{title:'測試路線',summary:'並非實際路線指引',startPoint:'僅供測試'}},recommendationEligible:true,isFixture:false,version:1};
test('recommendations fail closed for unapproved, stale or synthetic courses',()=>{
 assert.equal(getRecommendationEligibility(approved,now).eligible,true);
 for(const change of [{isFixture:true},{status:'draft'},{condition:'unknown'},{condition:'closed'},{conditionValidUntil:null},{conditionValidUntil:'2026-11-01T00:00:00Z'},{conditionValidUntil:'bad-date'},{reviewed:false},{reviewedAt:null},{translationStatus:'pending'},{translationSourceFingerprint:'b'.repeat(64)},{translations:{en:approved.translations.en}},{recommendationEligible:false},{sourceUrl:'javascript:alert(1)'}]){
  assert.equal(getRecommendationEligibility({...approved,...change},now).eligible,false,JSON.stringify(change));
 }
});
test('recommendation returns real empty results, caps three, filters ability and time',()=>{
 assert.deepEqual(recommendCourses([],defaultAnswers,now),[]);
 const courses=Array.from({length:8},(_,i)=>({...approved,id:`course-${i}`}));
 assert.equal(recommendCourses(courses,defaultAnswers,now).length,3);
 assert.equal(recommendCourses([{...approved,difficulty:'hard'}],defaultAnswers,now).length,0);
 assert.equal(recommendCourses([{...approved,durationMinutes:220}],{...defaultAnswers,time:'half',pace:'relaxed'},now).length,0);
 assert.equal(recommendCourses([{...approved,isFixture:true}],defaultAnswers,now).length,0);
});
test('untrusted course links cannot execute JavaScript or local files',()=>{
 for(const url of ['javascript:alert(1)','data:text/html,hello','file:///C:/private.txt','not a URL']) assert.equal(safeExternalUrl(url),null);
 assert.equal(safeExternalUrl('https://example.org/source'),'https://example.org/source');
});
