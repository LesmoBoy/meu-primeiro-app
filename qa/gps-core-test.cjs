const assert = require('node:assert/strict');
const Geo = require('../gps-core.js');
const now = Date.parse('2026-11-13T12:00:00Z');
let passed = 0;
function check(name, fn) { fn(); passed++; console.log('PASS', name); }
const position = (lat, lng, t, accuracy = 5, speed = null) => ({coords:{latitude:lat,longitude:lng,accuracy,speed},timestamp:t});
function first(mode='eco') { return Geo.accept(Geo.create('journey-test',mode,now),position(0,0,now),now).track; }

check('known geodesic distance and antimeridian are finite',()=>{
  assert.ok(Math.abs(Geo.distance({lat:0,lng:0},{lat:0,lng:1})-111195.08)<1);
  assert.ok(Math.abs(Geo.distance({lat:0,lng:179.999},{lat:0,lng:-179.999})-222.39)<1);
  assert.equal(Geo.distance({lat:0,lng:0},{lat:0,lng:0}),0);
});
check('first fix is a zero-distance baseline and engine is immutable',()=>{
  const original=Geo.create('journey-test','eco',now);
  const result=Geo.accept(original,position(0,0,now),now);
  assert.ok(result.accepted);assert.equal(result.reason,'first-fix');assert.equal(result.track.totalMeters,0);
  assert.equal(result.track.points[0].break,true);assert.equal(original.points.length,0);
});
check('real path accumulates accepted short segments in meters',()=>{
  let track=first();
  for(let i=1;i<=5;i++){
    const result=Geo.accept(track,position(0,i*.001,now+i*15000),now+i*15000);
    assert.ok(result.accepted,result.reason);track=result.track;
  }
  assert.ok(Math.abs(track.totalMeters-555.975)<1);assert.equal(track.points.length,6);
});
check('stationary jitter and too-frequent fixes never add kilometers',()=>{
  let track=first();
  for(let i=1;i<=10;i++){
    const result=Geo.accept(track,position(0,(i%2?1:-1)*.0001,now+i*15000,15,0),now+i*15000);
    assert.equal(result.accepted,false);assert.equal(result.reason,'stationary');
    assert.deepEqual(result.track.points,track.points);track=result.track;
  }
  assert.equal(track.totalMeters,0);
  assert.equal(track.gaps,0);
  assert.equal(Geo.accept(first(),position(0,.001,now+1000),now+1000).reason,'interval');
});
check('accuracy thresholds differ by mode and mode can be changed canonically',()=>{
  let eco=Geo.create('eco','eco',now),precise=Geo.create('precise','precise',now);
  assert.ok(Geo.accept(eco,position(0,0,now,60),now).accepted);
  assert.equal(Geo.accept(precise,position(0,0,now,60),now).reason,'accuracy');
  eco=Geo.validate({...eco,mode:'precise'});assert.equal(eco.mode,'precise');
  assert.equal(Geo.accept(eco,position(0,0,now,60),now).reason,'accuracy');
});
check('malformed, stale, future and repeated timestamps are rejected',()=>{
  const track=first();
  for(const bad of [position(NaN,0,now+15000),position(91,0,now+15000),position(0,181,now+15000),position(0,0,now+15000,-1)])assert.equal(Geo.accept(track,bad,now+15000).reason,'invalid');
  assert.equal(Geo.accept(track,position(0,.001,now+15000),now+100000).reason,'stale');
  assert.equal(Geo.accept(track,position(0,.001,now+15000),now).reason,'future');
  assert.equal(Geo.accept(track,position(0,.001,now),now).reason,'non-monotonic');
});
check('physically impossible GPS jump is ignored without moving the anchor',()=>{
  const track=first();const result=Geo.accept(track,position(0,1,now+15000),now+15000);
  assert.equal(result.reason,'jump');assert.equal(result.track,track);assert.equal(track.totalMeters,0);
});
check('pause and resume exclude intervening movement and cached pre-resume fixes',()=>{
  let track=first();track=Geo.accept(track,position(0,.001,now+15000),now+15000).track;
  const before=track.totalMeters;
  track=Geo.pause(track,now+20000);track=Geo.resume(track,now+60000);
  assert.equal(Geo.accept(track,position(0,.1,now+50000),now+60000).reason,'non-monotonic');
  const resumed=Geo.accept(track,position(0,.1,now+60000),now+60000);
  assert.ok(resumed.accepted);assert.equal(resumed.track.totalMeters,before);assert.equal(resumed.track.gaps,0);
  assert.equal(resumed.track.points.at(-1).break,true);
});
check('missing long intervals begin a new segment instead of inventing a straight-line trip',()=>{
  const track=first();const result=Geo.accept(track,position(0,.5,now+100000),now+100000);
  assert.ok(result.accepted);assert.equal(result.reason,'gap');assert.equal(result.track.totalMeters,0);
  assert.equal(result.track.gaps,1);assert.equal(result.track.points.at(-1).break,true);
});
check('canonical JSON validation strips unknown data and rejects corrupt persisted tracks',()=>{
  const track=first();const restored=Geo.validate(JSON.stringify({...track,secret:'excluded'}));
  assert.deepEqual(restored,track);assert.equal('secret'in restored,false);
  for(const change of [{totalMeters:-1},{mode:'turbo'},{gaps:NaN},{points:[{...track.points[0],lat:99}]},{lastFix:{...track.lastFix,t:now-1}}])assert.throws(()=>Geo.validate({...track,...change}));
  assert.throws(()=>Geo.create('<'.repeat(101),'eco',now));
});
check('long routes compact map history while retaining distance and segment boundaries',()=>{
  let track=first('precise');
  for(let i=1;i<=Geo.MAX_POINTS+8;i++){
    const t=now+i*8000;
    if(i===101)track=Geo.breakSegment(track,t,true);
    const result=Geo.accept(track,position(0,i*.0001,t),t);
    assert.ok(result.accepted,result.reason);track=result.track;
  }
  assert.ok(track.points.length<=Geo.MAX_POINTS);assert.ok(track.points.length>1000);
  assert.ok(track.totalMeters>44000);assert.equal(track.points[0].lng,0);
  assert.ok(track.points.filter(p=>p.break).length>=2);
  assert.equal(track.points.at(-1).lng,(Geo.MAX_POINTS+8)*.0001);
  assert.deepEqual(Geo.validate(JSON.stringify(track)),track);
});
check('GPX export preserves separate segments without user-controlled XML markup',()=>{
  let track=first();track=Geo.breakSegment(track,now+20000);
  track=Geo.accept(track,position(0,.1,now+20000),now+20000).track;
  track.id='<script>alert(1)</script>';
  const gpx=Geo.toGPX(track);assert.equal((gpx.match(/<trkseg>/g)||[]).length,2);
  assert.ok(gpx.includes('lat="0.0000000" lon="0.1000000"'));
  assert.ok(gpx.includes('2026-11-13T12:00:20.000Z'));assert.ok(!gpx.includes('<script>'));
});
console.log('PASS '+passed+' GPS core suites');
