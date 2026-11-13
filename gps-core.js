(function (root) {
  'use strict';

  // Pure calculations: no geolocation requests, storage, network or timers here.
  const EARTH_METERS = 6371008.8;
  const MAX_POINTS = 4000;
  const MAX_METERS = 100000000;
  const MAX_TIME = 8640000000000000;
  const MAX_AGE_MS = 45000;
  const MAX_GAP_MS = 90000;
  const MAX_SPEED_MPS = 55;
  const SAMPLE_MS = Object.freeze({eco: 15000, precise: 8000});
  const MAX_ACCURACY = Object.freeze({eco: 75, precise: 50});
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const time = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_TIME;

  function point(value) {
    if (!value || !finite(value.lat) || Math.abs(value.lat) > 90 ||
        !finite(value.lng) || Math.abs(value.lng) > 180 || !time(value.t) ||
        !finite(value.accuracy) || value.accuracy < 0 || value.accuracy > 10000000 ||
        typeof value.break !== 'boolean') throw Error('Ponto de GPS inválido.');
    return {lat: value.lat, lng: value.lng, t: value.t, accuracy: value.accuracy, break: value.break};
  }

  function validate(value) {
    const track = typeof value === 'string' ? JSON.parse(value) : value;
    if (!track || track.version !== 1 || typeof track.id !== 'string' || !track.id.trim() ||
        track.id.length > 100 || !own(SAMPLE_MS, track.mode) || typeof track.enabled !== 'boolean' ||
        !finite(track.totalMeters) || track.totalMeters < 0 || track.totalMeters > MAX_METERS ||
        !Array.isArray(track.points) || track.points.length > MAX_POINTS ||
        !Number.isSafeInteger(track.gaps) || track.gaps < 0 || track.gaps > 1000000 ||
        !time(track.createdAt) || !time(track.updatedAt) || track.updatedAt < track.createdAt ||
        !time(track.lastSampleAt) || track.lastSampleAt > track.updatedAt) throw Error('Percurso de GPS inválido.');
    const lastSeenAt = track.lastSeenAt === undefined ? track.lastSampleAt : track.lastSeenAt;
    if (!time(lastSeenAt) || lastSeenAt < track.lastSampleAt || lastSeenAt > track.updatedAt) throw Error('Horário do GPS inválido.');
    const points = track.points.map(point);
    for (let i = 0; i < points.length; i++) {
      if (points[i].t < track.createdAt || points[i].t > track.updatedAt ||
          (i > 0 && points[i].t <= points[i - 1].t)) throw Error('Horários do percurso inválidos.');
    }
    if (points.length) points[0].break = true;
    let lastFix = null;
    if (track.lastFix !== null) {
      lastFix = point(track.lastFix);
      const last = points.at(-1);
      if (!last || lastFix.t !== track.lastSampleAt || lastFix.t !== last.t ||
          lastFix.lat !== last.lat || lastFix.lng !== last.lng) throw Error('Referência de GPS inválida.');
      if (finite(track.lastFix.speed) && track.lastFix.speed >= 0) lastFix.speed = track.lastFix.speed;
    }
    return {version: 1, id: track.id, mode: track.mode, enabled: track.enabled,
      totalMeters: track.totalMeters, points, gaps: track.gaps, lastFix,
      lastSampleAt: track.lastSampleAt, lastSeenAt, createdAt: track.createdAt, updatedAt: track.updatedAt};
  }

  function create(id, mode = 'eco', now = Date.now()) {
    return validate({version: 1, id, mode, enabled: true, totalMeters: 0, points: [], gaps: 0,
      lastFix: null, lastSampleAt: 0, lastSeenAt: 0, createdAt: now, updatedAt: now});
  }

  function distance(a, b) {
    if (!a || !b || !finite(a.lat) || !finite(a.lng) || !finite(b.lat) || !finite(b.lng) ||
        Math.abs(a.lat) > 90 || Math.abs(b.lat) > 90 || Math.abs(a.lng) > 180 || Math.abs(b.lng) > 180) return NaN;
    const radians = Math.PI / 180;
    const dlat = (b.lat - a.lat) * radians;
    const dlng = (b.lng - a.lng) * radians;
    const h = Math.sin(dlat / 2) ** 2 + Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(dlng / 2) ** 2;
    return 2 * EARTH_METERS * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
  }

  function compress(points) {
    if (points.length <= MAX_POINTS) return points;
    const reduced = [points[0]];
    let segmentBoundary = false;
    for (let i = 1; i < points.length - 1; i++) {
      segmentBoundary = segmentBoundary || points[i].break;
      if (i % 2 === 0) {
        reduced.push({...points[i], break: segmentBoundary});
        segmentBoundary = false;
      }
    }
    const last = points.at(-1);
    reduced.push({...last, break: last.break || segmentBoundary});
    return reduced;
  }

  // Distance/anchors change only on accepted fixes. Valid stationary/interval fixes
  // update lastSeenAt, so a stopped vehicle is not mistaken for a missing GPS signal.
  function accept(original, position, now = Date.now()) {
    const reject = reason => ({track: original, accepted: false, reason});
    let track;
    try { track = validate(original); } catch { return reject('invalid'); }
    if (!track.enabled || !time(now)) return reject('invalid');
    const coords = position && position.coords;
    if (!coords || !finite(coords.latitude) || Math.abs(coords.latitude) > 90 ||
        !finite(coords.longitude) || Math.abs(coords.longitude) > 180 ||
        !finite(coords.accuracy) || coords.accuracy < 0 || !finite(position.timestamp)) return reject('invalid');
    const t = Math.round(position.timestamp);
    if (!time(t)) return reject('invalid');
    if (t > now + 1000) return reject('future');
    if (now - t > MAX_AGE_MS || t < track.createdAt) return reject('stale');
    const previous = track.lastFix;
    const lastPoint = track.points.at(-1);
    if ((previous && t <= track.lastSeenAt) || (!previous && t < track.lastSeenAt) ||
        (lastPoint && t <= lastPoint.t)) return reject('non-monotonic');
    if (coords.accuracy > MAX_ACCURACY[track.mode]) return reject('accuracy');
    const seen = reason => ({track: {...track, lastSeenAt:t, updatedAt:Math.max(track.updatedAt,now,t)}, accepted:false, reason});
    if (previous && t - track.lastSampleAt < SAMPLE_MS[track.mode]) return seen('interval');
    const next = {lat: coords.latitude, lng: coords.longitude, t, accuracy: coords.accuracy, break: !previous};
    const speed = finite(coords.speed) && coords.speed >= 0 ? coords.speed : null;
    const gap = Boolean(previous && t - track.lastSeenAt > MAX_GAP_MS);
    let meters = 0;
    if (previous && !gap) {
      meters = distance(previous, next);
      const speedSeconds = Math.max(SAMPLE_MS[track.mode],t-track.lastSeenAt)/1000;
      if (!finite(meters) || meters / speedSeconds > MAX_SPEED_MPS) return reject('jump');
      const uncertainty = Math.max(10, Math.min(30, (previous.accuracy + next.accuracy) / 2));
      if (speed !== null && speed < 0.6 && meters <= Math.max(40, (previous.accuracy + next.accuracy) * 2)) return seen('stationary');
      if (meters < uncertainty) return seen('jitter');
    }
    if (gap) next.break = true;
    const total = track.totalMeters + meters;
    if (!finite(total) || total > MAX_METERS) return reject('limit');
    const updated = {...track, totalMeters: total,
      points: compress([...track.points, next]), gaps: track.gaps + (gap ? 1 : 0),
      lastFix: speed === null ? {...next} : {...next, speed}, lastSampleAt: t, lastSeenAt:t,
      updatedAt: Math.max(track.updatedAt, now, t)};
    return {track: updated, accepted: true, reason: gap ? 'gap' : previous ? 'accepted' : 'first-fix'};
  }

  function breakSegment(value, now = Date.now(), gap = false) {
    const track = validate(value);
    if (!time(now)) throw Error('Horário da pausa inválido.');
    const boundary = Math.max(now, track.updatedAt, track.lastSampleAt);
    return {...track, lastFix: null, lastSampleAt: boundary, lastSeenAt:boundary, updatedAt: boundary,
      gaps: track.gaps + (gap ? 1 : 0)};
  }

  function toGPX(value) {
    const track = validate(value);
    const lines = ['<?xml version="1.0" encoding="UTF-8"?>',
      '<gpx version="1.1" creator="Minha Rodagem" xmlns="http://www.topografix.com/GPX/1/1">', '<trk><name>Percurso GPS</name>'];
    let segment = false;
    for (const p of track.points) {
      if (!segment || p.break) {
        if (segment) lines.push('</trkseg>');
        lines.push('<trkseg>');
        segment = true;
      }
      lines.push('<trkpt lat="' + p.lat.toFixed(7) + '" lon="' + p.lng.toFixed(7) + '"><time>' + new Date(p.t).toISOString() + '</time></trkpt>');
    }
    if (segment) lines.push('</trkseg>');
    lines.push('</trk></gpx>');
    return lines.join('\n');
  }

  const api = Object.freeze({create, validate, accept, distance, breakSegment,
    pause: (track, now) => breakSegment(track, now, false),
    resume: (track, now) => breakSegment(track, now, false), toGPX,
    MAX_POINTS, MAX_METERS, MAX_AGE_MS, MAX_GAP_MS, MAX_SPEED_MPS, SAMPLE_MS, MAX_ACCURACY});
  root.RodagemGeo = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
