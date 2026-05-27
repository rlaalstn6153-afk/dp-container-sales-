/**
 * supabase_init.js — 컨테이너 DP 매각 플랫폼 Supabase 연동
 *
 * 사용 방법:
 *   index.html <head> 또는 스크립트 최상단에 아래 두 줄을 추가하세요.
 *
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *   <script src="supabase_init.js"></script>
 *
 * Supabase 테이블 스키마 (SQL):
 * ──────────────────────────────────────────────────────────────────
 * CREATE TABLE dp_lots (
 *   id          TEXT PRIMARY KEY,         -- 'LOT001', 'LOT002', ...
 *   region      TEXT NOT NULL,            -- '한국' | '중국' | '일본' | '동남아'
 *   port        TEXT NOT NULL,
 *   type        TEXT NOT NULL,            -- '20GP', '40HC', '20RF', ...
 *   qty         INT  NOT NULL DEFAULT 0,
 *   year        TEXT,                     -- 제조 연도 범위 (예: '2006~2009')
 *   condition   TEXT,                     -- 'IICL' | 'CWO' | 'AS-IS'
 *   price       INT,                      -- USD/Unit (null = 협의)
 *   deadline    TEXT,                     -- 'YYYY-MM-DD'
 *   note        TEXT,
 *   active      BOOLEAN NOT NULL DEFAULT true,
 *   created     TEXT                      -- 'YYYY-MM-DD'
 * );
 *
 * CREATE TABLE dp_bids (
 *   id          TEXT PRIMARY KEY,         -- 'BID' + timestamp + random
 *   lot_id      TEXT REFERENCES dp_lots(id),
 *   port        TEXT,
 *   type        TEXT,
 *   company     TEXT NOT NULL,
 *   name        TEXT NOT NULL,
 *   email       TEXT NOT NULL,
 *   phone       TEXT,
 *   qty         INT,
 *   price       INT,
 *   inco        TEXT,                     -- 인도 조건 (EXW, FOB, ...)
 *   take        TEXT,                     -- 희망 인수일
 *   note        TEXT,
 *   created     TEXT                      -- 'YYYY-MM-DD'
 * );
 *
 * -- Realtime 활성화 (dp_bids 테이블)
 * ALTER TABLE dp_bids REPLICA IDENTITY FULL;
 * ALTER PUBLICATION supabase_realtime ADD TABLE dp_bids;
 *
 * -- RLS (공개 읽기, 관리자 쓰기는 별도 Auth 설정 필요)
 * ALTER TABLE dp_lots ENABLE ROW LEVEL SECURITY;
 * ALTER TABLE dp_bids ENABLE ROW LEVEL SECURITY;
 * CREATE POLICY "public_read"  ON dp_lots USING (true);
 * CREATE POLICY "public_read"  ON dp_bids USING (true);
 * CREATE POLICY "public_write" ON dp_lots WITH CHECK (true);
 * CREATE POLICY "public_write" ON dp_bids WITH CHECK (true);
 * ──────────────────────────────────────────────────────────────────
 */

// ── 환경 상수 ──────────────────────────────────────────────────────
const SUPABASE_URL      = 'https://jqaacqzeobkjrowccbct.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_5YwEfa3vkSbWHpVHCnnR3Q_rU2R5jGb';

// ── 클라이언트 초기화 ────────────────────────────────────────────
let _sb = null;
let _sbAvailable = false;
let _realtimeChannel = null;

(function initSupabase() {
  try {
    if (typeof supabase !== 'undefined' && supabase.createClient) {
      _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      _sbAvailable = true;
      console.log('[Supabase] 클라이언트 초기화 완료');
    } else {
      console.warn('[Supabase] SDK 미로드 — localStorage fallback 활성화');
    }
  } catch (e) {
    console.warn('[Supabase] 초기화 실패 — localStorage fallback 활성화', e);
  }
})();

// ── 내부 헬퍼: lot 행 변환 ──────────────────────────────────────
function _lotToRow(lot) {
  return {
    id:        lot.id,
    region:    lot.region,
    port:      lot.port,
    type:      lot.type,
    qty:       lot.qty,
    year:      lot.year       || null,
    condition: lot.condition  || null,
    price:     lot.price      || null,
    deadline:  lot.deadline   || null,
    note:      lot.note       || null,
    active:    lot.active !== undefined ? lot.active : true,
    created:   lot.created    || new Date().toISOString().slice(0, 10),
  };
}

function _lotFromRow(row) {
  return {
    id:        row.id,
    region:    row.region,
    port:      row.port,
    type:      row.type,
    qty:       row.qty,
    year:      row.year,
    condition: row.condition,
    price:     row.price,
    deadline:  row.deadline,
    note:      row.note,
    active:    row.active,
    created:   row.created,
  };
}

function _bidToRow(bid) {
  return {
    id:       bid.id,
    lot_id:   bid.lotId,
    port:     bid.port    || null,
    type:     bid.type    || null,
    company:  bid.company,
    name:     bid.name,
    email:    bid.email,
    phone:    bid.phone   || null,
    qty:      bid.qty     || null,
    price:    bid.price   || null,
    inco:     bid.inco    || null,
    take:     bid.take    || null,
    note:     bid.note    || null,
    created:  bid.created || new Date().toISOString().slice(0, 10),
  };
}

function _bidFromRow(row) {
  return {
    id:      row.id,
    lotId:   row.lot_id,
    port:    row.port,
    type:    row.type,
    company: row.company,
    name:    row.name,
    email:   row.email,
    phone:   row.phone,
    qty:     row.qty,
    price:   row.price,
    inco:    row.inco,
    take:    row.take,
    note:    row.note,
    created: row.created,
  };
}

// ── localStorage fallback 키 (기존 앱과 동일) ───────────────────
const _LS_LOTS = 'dp_lots';
const _LS_BIDS = 'dp_bids';

function _lsLoadLots() {
  try { return JSON.parse(localStorage.getItem(_LS_LOTS) || 'null'); }
  catch { return null; }
}
function _lsSaveLots(arr) {
  localStorage.setItem(_LS_LOTS, JSON.stringify(arr));
}
function _lsLoadBids() {
  try { return JSON.parse(localStorage.getItem(_LS_BIDS) || '[]'); }
  catch { return []; }
}
function _lsSaveBids(arr) {
  localStorage.setItem(_LS_BIDS, JSON.stringify(arr));
}

// ════════════════════════════════════════════════════════════════
// 공개 API
// ════════════════════════════════════════════════════════════════

/**
 * 활성 LOT 전체 조회 (active = true)
 * @returns {Promise<{ok:boolean, data:object[], error?:any}>}
 */
async function sbLoadLots() {
  if (!_sbAvailable) {
    const stored = _lsLoadLots();
    const data = stored ? stored.filter(l => l.active) : [];
    return { ok: true, data };
  }
  try {
    const { data, error } = await _sb
      .from('dp_lots')
      .select('*')
      .eq('active', true)
      .order('deadline', { ascending: true });
    if (error) throw error;
    return { ok: true, data: (data || []).map(_lotFromRow) };
  } catch (e) {
    console.error('[sbLoadLots] Supabase 오류 → localStorage fallback', e);
    const stored = _lsLoadLots();
    const data = stored ? stored.filter(l => l.active) : [];
    return { ok: false, data, error: e };
  }
}

/**
 * LOT 저장/수정 (upsert) — 관리자 전용
 * @param {object} lot  - dp_lots 행 객체
 * @returns {Promise<{ok:boolean, error?:any}>}
 */
async function sbSaveLot(lot) {
  if (!_sbAvailable) {
    const stored = _lsLoadLots() || [];
    const idx = stored.findIndex(l => l.id === lot.id);
    if (idx >= 0) stored[idx] = lot; else stored.push(lot);
    _lsSaveLots(stored);
    return { ok: true };
  }
  try {
    const { error } = await _sb
      .from('dp_lots')
      .upsert(_lotToRow(lot), { onConflict: 'id' });
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    console.error('[sbSaveLot] Supabase 오류 → localStorage fallback', e);
    const stored = _lsLoadLots() || [];
    const idx = stored.findIndex(l => l.id === lot.id);
    if (idx >= 0) stored[idx] = lot; else stored.push(lot);
    _lsSaveLots(stored);
    return { ok: false, error: e };
  }
}

/**
 * LOT 삭제 — 관리자 전용
 * @param {string} id  - lot.id (예: 'LOT001')
 * @returns {Promise<{ok:boolean, error?:any}>}
 */
async function sbDeleteLot(id) {
  if (!_sbAvailable) {
    const stored = (_lsLoadLots() || []).filter(l => l.id !== id);
    _lsSaveLots(stored);
    return { ok: true };
  }
  try {
    const { error } = await _sb
      .from('dp_lots')
      .delete()
      .eq('id', id);
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    console.error('[sbDeleteLot] Supabase 오류 → localStorage fallback', e);
    const stored = (_lsLoadLots() || []).filter(l => l.id !== id);
    _lsSaveLots(stored);
    return { ok: false, error: e };
  }
}

/**
 * 입찰 제출
 * @param {object} bid  - bids 배열에 push 되는 입찰 객체
 * @returns {Promise<{ok:boolean, error?:any}>}
 */
async function sbSubmitBid(bid) {
  if (!_sbAvailable) {
    const arr = _lsLoadBids();
    arr.push(bid);
    _lsSaveBids(arr);
    return { ok: true };
  }
  try {
    const { error } = await _sb
      .from('dp_bids')
      .insert(_bidToRow(bid));
    if (error) throw error;
    // localStorage에도 동기화 (오프라인 캐시)
    const arr = _lsLoadBids();
    arr.push(bid);
    _lsSaveBids(arr);
    return { ok: true };
  } catch (e) {
    console.error('[sbSubmitBid] Supabase 오류 → localStorage fallback', e);
    const arr = _lsLoadBids();
    arr.push(bid);
    _lsSaveBids(arr);
    return { ok: false, error: e };
  }
}

/**
 * 특정 LOT의 입찰 목록 조회
 * @param {string} lotId  - 조회할 lot.id
 * @returns {Promise<{ok:boolean, data:object[], error?:any}>}
 */
async function sbLoadBids(lotId) {
  if (!_sbAvailable) {
    const arr = _lsLoadBids().filter(b => b.lotId === lotId);
    return { ok: true, data: arr };
  }
  try {
    const { data, error } = await _sb
      .from('dp_bids')
      .select('*')
      .eq('lot_id', lotId)
      .order('created', { ascending: false });
    if (error) throw error;
    return { ok: true, data: (data || []).map(_bidFromRow) };
  } catch (e) {
    console.error('[sbLoadBids] Supabase 오류 → localStorage fallback', e);
    const arr = _lsLoadBids().filter(b => b.lotId === lotId);
    return { ok: false, data: arr, error: e };
  }
}

/**
 * 특정 LOT 입찰 Realtime 구독
 * 새 입찰이 insert 될 때마다 callback(bid) 으로 알립니다.
 *
 * @param {string}   lotId     - 구독할 lot.id
 * @param {function} callback  - (bid: object) => void
 * @returns {{ unsubscribe: function }}  구독 해제 객체
 *
 * 사용 예:
 *   const sub = sbSubscribeBids('LOT001', (bid) => {
 *     bids.push(bid);
 *     renderAdmin();
 *   });
 *   // 해제 시: sub.unsubscribe();
 */
function sbSubscribeBids(lotId, callback) {
  if (!_sbAvailable) {
    console.warn('[sbSubscribeBids] Supabase 미연결 — Realtime 비활성');
    return { unsubscribe: () => {} };
  }

  // 기존 채널 정리
  if (_realtimeChannel) {
    _sb.removeChannel(_realtimeChannel);
    _realtimeChannel = null;
  }

  _realtimeChannel = _sb
    .channel(`dp_bids:lot_id=eq.${lotId}`)
    .on(
      'postgres_changes',
      {
        event:  'INSERT',
        schema: 'public',
        table:  'dp_bids',
        filter: `lot_id=eq.${lotId}`,
      },
      (payload) => {
        if (payload.new) {
          const bid = _bidFromRow(payload.new);
          // localStorage 캐시 업데이트
          const arr = _lsLoadBids();
          if (!arr.find(b => b.id === bid.id)) {
            arr.push(bid);
            _lsSaveBids(arr);
          }
          callback(bid);
        }
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log(`[sbSubscribeBids] LOT ${lotId} Realtime 구독 완료`);
      }
    });

  return {
    unsubscribe: () => {
      if (_realtimeChannel) {
        _sb.removeChannel(_realtimeChannel);
        _realtimeChannel = null;
        console.log(`[sbSubscribeBids] LOT ${lotId} 구독 해제`);
      }
    },
  };
}

/**
 * 전체 LOT 조회 (active 여부 무관) — 관리자 전용
 * @returns {Promise<{ok:boolean, data:object[], error?:any}>}
 */
async function sbLoadAllLots() {
  if (!_sbAvailable) {
    const stored = _lsLoadLots();
    return { ok: true, data: stored || [] };
  }
  try {
    const { data, error } = await _sb
      .from('dp_lots')
      .select('*')
      .order('deadline', { ascending: true });
    if (error) throw error;
    return { ok: true, data: (data || []).map(_lotFromRow) };
  } catch (e) {
    console.error('[sbLoadAllLots] Supabase 오류 → localStorage fallback', e);
    const stored = _lsLoadLots();
    return { ok: false, data: stored || [], error: e };
  }
}

/**
 * 전체 입찰 조회 (모든 LOT) — 관리자 전용
 * @returns {Promise<{ok:boolean, data:object[], error?:any}>}
 */
async function sbLoadAllBids() {
  if (!_sbAvailable) {
    return { ok: true, data: _lsLoadBids() };
  }
  try {
    const { data, error } = await _sb
      .from('dp_bids')
      .select('*')
      .order('created', { ascending: false });
    if (error) throw error;
    return { ok: true, data: (data || []).map(_bidFromRow) };
  } catch (e) {
    console.error('[sbLoadAllBids] Supabase 오류 → localStorage fallback', e);
    return { ok: false, data: _lsLoadBids(), error: e };
  }
}

/**
 * 전체 dp_bids 테이블 Realtime 구독 — 관리자 전용
 * 어느 LOT든 새 입찰이 들어오면 callback(bid)으로 알립니다.
 *
 * @param {function} callback  - (bid: object) => void
 * @returns {{ unsubscribe: function }}
 */
function sbSubscribeAllBids(callback) {
  if (!_sbAvailable) {
    console.warn('[sbSubscribeAllBids] Supabase 미연결 — Realtime 비활성');
    return { unsubscribe: () => {} };
  }

  // 기존 채널 정리
  if (_realtimeChannel) {
    _sb.removeChannel(_realtimeChannel);
    _realtimeChannel = null;
  }

  _realtimeChannel = _sb
    .channel('dp_bids:all')
    .on(
      'postgres_changes',
      {
        event:  'INSERT',
        schema: 'public',
        table:  'dp_bids',
      },
      (payload) => {
        if (payload.new) {
          const bid = _bidFromRow(payload.new);
          // localStorage 캐시 업데이트
          const arr = _lsLoadBids();
          if (!arr.find(b => b.id === bid.id)) {
            arr.unshift(bid);
            _lsSaveBids(arr);
          }
          callback(bid);
        }
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('[sbSubscribeAllBids] 전체 입찰 Realtime 구독 완료');
      }
    });

  return {
    unsubscribe: () => {
      if (_realtimeChannel) {
        _sb.removeChannel(_realtimeChannel);
        _realtimeChannel = null;
        console.log('[sbSubscribeAllBids] 전체 입찰 구독 해제');
      }
    },
  };
}

