(() => {
  const el = (id) => document.getElementById(id);

  const analyzeBtn = el('analyzeBtn');
  const clearBtn = el('clearBtn');
  const loadLastBtn = el('loadLastBtn');
  const contextEl = el('context');
  const categoryEl = el('category');
  const resultsEl = el('results');
  const scoreNumberEl = el('scoreNumber');
  const scoreBarEl = el('scoreBar');
  const delayStatusEl = document.getElementById('delayStatus');
  const lineLabelEl = document.getElementById('lineLabel');
  const certTextEl = document.getElementById('certificateText');
  const copyCertBtn = document.getElementById('copyCertBtn');
  const printBtn = document.getElementById('printBtn');
  const idealEl = el('ideal');
  const gapsEl = el('gaps');
  const actionsEl = el('actions');
  const breakdownEl = el('breakdown');
  const debugEl = el('debug');

  const useApiEl = el('useApi');
  const apiKeyEl = el('apiKey');
  const apiBaseEl = el('apiBase');
  const apiModelEl = el('apiModel');
  const apiModeEl = el('apiMode');
  const enableSEEl = document.getElementById('enableSE');

  // ---------- Utilities ----------
  const normalize = (s) => (s || '')
    .replace(/[\u3000\s]+/g, ' ')
    .replace(/[\t\r\n]+/g, ' ')
    .trim();

  const containsAny = (text, list) => list.some(w => text.includes(w));

  const kv = (k, v) => ({ key: k, value: v });

  // Shared weights
  const DIM_WEIGHTS = { clarity: 0.25, execution: 0.25, planning: 0.2, resources: 0.15, feedback: 0.15 };

  // ---------- Classification ----------
  const CATEGORY_KEYWORDS = {
    health: ['運動', '筋トレ', '体重', '睡眠', '食事', '早起き', 'ジョギング', 'ヨガ', '禁煙', '禁酒', 'ストレッチ'],
    study: ['勉強', '学習', '英語', 'TOEIC', '資格', '試験', '読書', '単語', '受験'],
    work: ['仕事', 'キャリア', '転職', 'プロジェクト', '生産性', '会議', 'タスク', '締切'],
    finance: ['貯金', '節約', '投資', '家計', '収入', '支出', '予算'],
    relationship: ['家族', '友達', '恋人', '同僚', '人間関係', 'コミュニケーション'],
    habit: ['習慣', '毎日', 'ルーティン', '継続', '三日坊主']
  };

  function detectCategory(text, selected) {
    if (selected && selected !== 'auto') return selected;
    for (const [cat, keys] of Object.entries(CATEGORY_KEYWORDS)) {
      if (containsAny(text, keys)) return cat;
    }
    return 'other';
  }

  // ---------- Extraction ----------
  function extractNumbers(text) {
    const nums = [];
    const re = /(\d+\.?\d*)\s*(回|分|時間|日|週|月|年|kg|キロ|点|万円|円)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const n = parseFloat(m[1]);
      const unit = m[2];
      nums.push({ n, unit });
    }
    return nums;
  }

  function flags(text) {
    const goalWords = ['目標', 'したい', 'なりたい', '達成', '上げたい', '減らしたい', '増やしたい', '合格', '伸ばしたい'];
    const obstacleWords = ['疲れ', '疲れて', '時間がない', '続かない', '難しい', 'できない', '挫折', '忙しい', '眠い', '誘惑'];
    const planWords = ['計画', 'スケジュール', '毎日', '毎朝', '朝', '夜', '週', '曜日', 'ルーティン', '習慣'];
    const resourceWords = ['アプリ', 'タイマー', 'ツール', '本', '環境', '場所', 'デスク', '準備', '通知'];
    const feedbackWords = ['記録', 'ログ', '可視化', 'グラフ', '振り返り', 'レビュー', '日報', '週間レビュー'];
    const executionPos = ['続けている', 'できている', '実践', '達成した', '継続中'];
    const executionNeg = ['続かない', 'できていない', 'サボった', '三日坊主', '未達'];
    const deadlineWords = ['までに', '締切', '期限', 'デッドライン', '今月', '来月', '半年', '6ヶ月', '1年'];
    return {
      hasGoal: containsAny(text, goalWords),
      hasObstacle: containsAny(text, obstacleWords),
      hasPlan: containsAny(text, planWords),
      hasResource: containsAny(text, resourceWords),
      hasFeedback: containsAny(text, feedbackWords),
      execPos: containsAny(text, executionPos),
      execNeg: containsAny(text, executionNeg),
      hasDeadline: containsAny(text, deadlineWords)
    };
  }

  // ---------- Scoring ----------
  function computeScores(text) {
    const f = flags(text);
    const nums = extractNumbers(text);

    // 目標明確さ: 数値/単位や期限の有無で上げる
    const hasQuant = nums.length > 0;
    let clarity = 20;
    if (f.hasGoal) clarity += 20;
    if (hasQuant) clarity += 30;
    if (f.hasDeadline) clarity += 20;
    if (f.hasPlan) clarity += 10;
    clarity = Math.min(100, clarity);

    // 実行度: ポジ/ネガ言及と障害で上下
    let execution = 50;
    if (f.execPos) execution += 20;
    if (f.execNeg) execution -= 25;
    if (f.hasObstacle) execution -= 10;
    // 週・回・分の具体性があると少し上げる
    if (nums.some(x => ['週', '回', '分', '時間'].includes(x.unit))) execution += 5;
    execution = clamp(execution);

    // 計画性
    let planning = 40 + (f.hasPlan ? 25 : 0) + (f.hasDeadline ? 10 : 0) + (hasQuant ? 10 : 0);
    planning = clamp(planning);

    // リソース
    let resources = 35 + (f.hasResource ? 30 : 0);
    // 朝/夜/場所など環境語があれば加点
    if (containsAny(text, ['朝', '夜', '通勤', '自宅', 'カフェ', '図書館'])) resources += 10;
    resources = clamp(resources);

    // フィードバック
    let feedback = 30 + (f.hasFeedback ? 40 : 0);
    if (containsAny(text, ['毎週', '週次', '週末'])) feedback += 10;
    feedback = clamp(feedback);

    const overall = Math.round(
      clarity * DIM_WEIGHTS.clarity +
      execution * DIM_WEIGHTS.execution +
      planning * DIM_WEIGHTS.planning +
      resources * DIM_WEIGHTS.resources +
      feedback * DIM_WEIGHTS.feedback
    );

    return { clarity, execution, planning, resources, feedback, overall, flags: f, numbers: nums };
  }

  function clamp(n) { return Math.max(0, Math.min(100, Math.round(n))); }

  // Convert scores to delay minutes (0-120min, lower score => larger delay)
  function computeDelays(scores) {
    const factor = 1.2; // 100 -> 0分, 0 -> 120分
    const toMin = (p) => Math.max(0, Math.min(120, Math.round((100 - p) * factor)));
    return {
      overall: toMin(scores.overall),
      // per-dimension independent mapping (not used for内訳の分配)
      clarity: toMin(scores.clarity),
      execution: toMin(scores.execution),
      planning: toMin(scores.planning),
      resources: toMin(scores.resources),
      feedback: toMin(scores.feedback)
    };
  }

  // Allocate overall delay into dimension contributions so that sum equals overall
  function allocateDelay(overallDelay, scores) {
    const deficits = {
      clarity: 100 - scores.clarity,
      execution: 100 - scores.execution,
      planning: 100 - scores.planning,
      resources: 100 - scores.resources,
      feedback: 100 - scores.feedback
    };
    // Weight by dimension weights to reflect影響度
    const weighted = Object.fromEntries(Object.entries(deficits).map(([k,v]) => [k, Math.max(0, v) * DIM_WEIGHTS[k]]));
    const sumW = Object.values(weighted).reduce((a,b)=>a+b,0) || 1;
    const rawShares = Object.fromEntries(Object.entries(weighted).map(([k,v]) => [k, (overallDelay * v / sumW)]));
    // Round and fix rounding error
    const rounded = Object.fromEntries(Object.entries(rawShares).map(([k,v]) => [k, Math.round(v)]));
    let diff = overallDelay - Object.values(rounded).reduce((a,b)=>a+b,0);
    if (diff !== 0) {
      // Adjust the largest remainder direction
      const remainders = Object.entries(rawShares).map(([k,v]) => ({k, frac: v - Math.floor(v)}));
      remainders.sort((a,b)=> b.frac - a.frac);
      const target = (diff > 0)
        ? remainders[0]?.k
        : remainders[remainders.length-1]?.k;
      if (target) rounded[target] += diff;
    }
    return rounded;
  }

  // Simple SE via WebAudio
  let _ac = null;
  async function playSE(level) {
    try {
      if (!enableSEEl || !enableSEEl.checked) return;
      if (!_ac) _ac = new (window.AudioContext || window.webkitAudioContext)();
      const beeps = level === 'alert' ? 3 : level === 'warn' ? 2 : 1;
      const start = _ac.currentTime + 0.02;
      for (let i=0;i<beeps;i++) {
        const t0 = start + i*0.18;
        const osc = _ac.createOscillator();
        const gain = _ac.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(level==='alert'?660: (level==='warn'?740:880), t0);
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.2, t0+0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0+0.14);
        osc.connect(gain).connect(_ac.destination);
        osc.start(t0);
        osc.stop(t0+0.16);
      }
    } catch {}
  }

  // ---------- Ideal State & Advice ----------
  function buildIdeal(category, scores, text) {
    const n = pickNumbers(scores.numbers);
    const base = {
      study: `6ヶ月後、週${n.freqPerWeek}回×${n.minutes}分の学習が自動化。明確な範囲（例: 単語/長文/リスニング）を日別に配分し、朝の固定スロットに実施。記録と週次レビューで改善サイクルを回し、定量目標（例: TOEIC ${n.points}点）を達成。` ,
      health: `12週間後、週${n.freqPerWeek}回×${n.minutes}分の運動ルーティンが定着。睡眠と食事の基本を整え、前日夜にウェア/水分をセット。実施は同じ時間帯、タイマーで計測、記録と週次レビューで負荷を段階的に増やす。` ,
      work: `四半期内に、最重要プロジェクトへ毎日${n.minutes}分の集中ブロックを確保。週${n.freqPerWeek}回の見直しで優先度を整理、会議はバッチ化。可視化ボードで進捗を管理し、締切に向けて段階ゴールを達成。` ,
      finance: `3ヶ月後、月${n.amount}円の自動貯金と支出の可視化が定着。固定費を見直し、週${n.freqPerWeek}回の家計チェックで予算内に運用。投資は定額積立で感情を排除。` ,
      relationship: `次の8週間、週${n.freqPerWeek}回の短い連絡/感謝メッセージと、月1回の質の高い時間を設計。相手の関心事リストを作成し、会話の質を上げる。` ,
      habit: `6週間で、毎日${n.minutes}分の小さな行動が自動化。トリガー（行動の直前）を固定し、摩擦を徹底削減。記録と連続日数で動機づけ、徐々に拡張。` ,
      other: `今後12週間で、週${n.freqPerWeek}回×${n.minutes}分の集中行動を固定。実施時間帯と場所を一定にし、妨げ要因を先回り除去。記録と週次レビューで改善を継続。`
    };
    return base[category] || base.other;
  }

  function buildGaps(scores) {
    const entries = [
      kv('目標の明確さ', scores.clarity),
      kv('実行・継続', scores.execution),
      kv('計画・一貫性', scores.planning),
      kv('リソース整備', scores.resources),
      kv('記録・振り返り', scores.feedback)
    ].sort((a, b) => a.value - b.value);
    const lines = entries.slice(0, 3).map(e => {
      if (e.key === '目標の明確さ') return '数値と期限を伴う目標の言語化が不足。1つの指標と締切を決める。';
      if (e.key === '実行・継続') return '行動のハードルが高い/障害が未対策。行動を小さくし、妨げを事前に除去。';
      if (e.key === '計画・一貫性') return '時間帯や頻度が不安定。固定スロットと週次の見直しを設定。';
      if (e.key === 'リソース整備') return '場所/ツール/事前準備が曖昧。物理的・デジタル環境を整える。';
      return '記録/レビューの仕組みがない。簡易な記録と週次レビューを導入。';
    });
    return lines;
  }

  function buildActions(category, scores) {
    const low = Object.entries({
      clarity: scores.clarity,
      execution: scores.execution,
      planning: scores.planning,
      resources: scores.resources,
      feedback: scores.feedback
    }).sort((a,b)=>a[1]-b[1]).map(([k])=>k);

    const n = pickNumbers(scores.numbers);
    const common = [
      `時間固定: ${pickTimeSlot()}に${n.minutes}分、週${n.freqPerWeek}回のスロットを2週間確保（カレンダー/リマインダー）。`,
      `行動を極小化: できる最小単位に分割（例: ${category === 'study' ? '単語10個' : '5分ウォームアップ'}）。` ,
      `障害の先回り: 「疲れ/誘惑/場所」対策を前夜に準備（服/道具/アプリ起動）。`,
      `記録: 実施/未実施のみ記録（○/×）。週1回、改善点を1つだけ決める。`
    ];

    const perDim = {
      clarity: `数値×期限の目標を1つ: 「${categoryLabel(category)}を${deadlineLabel()}までに${targetLabel(category, n)}」と紙/メモに固定。`,
      execution: `トリガー設計: 既存習慣の直後に紐付け（例: 歯磨き後に${shortAct(category)}）。連続日数を可視化。`,
      planning: `週次レビューの予約: 毎週${pickWeekday()}に15分、進捗チェックと翌週の予約を実施。`,
      resources: `環境の摩擦除去: ${envPrep(category)}を常設し、1タップ/1手で開始できる状態にする。`,
      feedback: `ログの自動化: ${logTool(category)}に○/×だけ記録。2週間ごとに小改善を1つ。`
    };

    const top3 = low.slice(0, 3).map(dim => perDim[dim]);
    return [...top3, ...common].slice(0, 5);
  }

  function categoryLabel(c){
    return ({study:'学習', health:'健康', work:'仕事', finance:'家計', relationship:'関係', habit:'習慣', other:'取り組み'})[c] || '取り組み';
  }
  function lineLabel(c){
    const map = { study:'学習線', health:'健康線', work:'仕事線', finance:'家計線', relationship:'関係線', habit:'習慣線', other:'一般線' };
    return map[c] || '一般線';
  }
  function deadlineLabel(){
    const opts = ['今月末', '来月末', '6週間後', '3ヶ月後', '四半期末'];
    return opts[Math.floor(Math.random()*opts.length)];
  }
  function targetLabel(c, n){
    if (c==='study') return `TOEIC ${n.points}点/参考書${Math.max(1, Math.round(n.freqPerWeek/2))}章`;
    if (c==='health') return `${n.freqPerWeek}回運動/体幹${n.minutes}分`;
    if (c==='work') return `最重要タスク${n.minutes}分×${n.freqPerWeek}回/週`;
    if (c==='finance') return `月${n.amount}円の黒字維持`;
    if (c==='relationship') return `週${n.freqPerWeek}回の連絡と月1回の時間`;
    return `週${n.freqPerWeek}回×${n.minutes}分の実行`;
  }
  function shortAct(c){
    if (c==='study') return '3分音読';
    if (c==='health') return '1分ストレッチ';
    if (c==='work') return '30秒でタスク起票';
    if (c==='finance') return '家計アプリ起動';
    if (c==='relationship') return '30秒で感謝メモ';
    return '1分だけ着手';
  }
  function envPrep(c){
    if (c==='study') return '教材/タイマー/イヤホン';
    if (c==='health') return 'ウェア/シューズ/水';
    if (c==='work') return '集中用デスク/Do Not Disturb';
    if (c==='finance') return '家計アプリ/レシート箱';
    if (c==='relationship') return '連絡先リスト/話題メモ';
    return '道具/アプリのショートカット';
  }
  function logTool(c){
    if (c==='finance') return '家計簿アプリ';
    return 'メモ/スプレッドシート';
  }
  function pickTimeSlot(){
    const opts = ['朝7:00', '出勤前', '昼休み', '退勤直後', '21:00'];
    return opts[Math.floor(Math.random()*opts.length)];
  }
  function pickWeekday(){
    const opts = ['金曜', '土曜', '日曜'];
    return opts[Math.floor(Math.random()*opts.length)];
  }
  function pickNumbers(numbers){
    const obj = { minutes: 20, freqPerWeek: 3, points: 700, amount: 20000 };
    numbers.forEach(({n, unit}) => {
      if (unit === '分') obj.minutes = Math.max(5, Math.min(120, Math.round(n)));
      if (unit === '時間') obj.minutes = Math.max(5, Math.min(180, Math.round(n*60)));
      if (unit === '回' || unit === '週') obj.freqPerWeek = Math.max(1, Math.min(7, Math.round(n)));
      if (unit === '点') obj.points = Math.max(200, Math.min(990, Math.round(n)));
      if (unit === '円' || unit === '万円') obj.amount = Math.max(1000, Math.round(unit==='万円' ? n*10000 : n));
      if (unit === 'kg' || unit === 'キロ') {/* no-op here but could map */}
    });
    return obj;
  }

  // ---------- API (optional) ----------
  async function tryApi(context, category, scores) {
    if (!useApiEl.checked) return null;
    const key = apiKeyEl.value.trim();
    const base = apiBaseEl.value.trim();
    const model = apiModelEl.value.trim() || 'gpt-4o-mini';
    if (!key || !base) return null;
    const sys = 'あなたは熟練のコーチ兼プランナーです。入力から理想像・達成度・具体アクションを日本語で簡潔に出力してください。';
    const user = `カテゴリ: ${category}\n現状: ${context}\nヒント(機械推定): ${JSON.stringify(scores)}`;
    try {
      const res = await fetch(`${base.replace(/\/$/, '')}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({ model, messages: [{role:'system', content: sys}, {role:'user', content: user}], temperature: 0.3 })
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content?.trim();
      return content || null;
    } catch (e) {
      console.warn('API error, fallback to local:', e);
      return null;
    }
  }

  // Full evaluation via API (returns structured result or null)
  async function apiFullEvaluate(context, category) {
    if (!useApiEl.checked) return null;
    const key = apiKeyEl.value.trim();
    const base = apiBaseEl.value.trim();
    const model = apiModelEl.value.trim() || 'gpt-4o-mini';
    if (!key || !base) return null;
    const sys = 'あなたは熟練のコーチ兼プランナーです。日本語で、指定スキーマのJSONのみを返してください。説明文は不要です。数値は0-100の整数で返してください。';
    const user = `カテゴリ: ${category}\n現状: ${context}\n出力スキーマ(JSON): {"overall": number, "breakdown": {"clarity": number, "execution": number, "planning": number, "resources": number, "feedback": number}, "ideal": string, "gaps": string[], "actions": string[]}`;
    try {
      const res = await fetch(`${base.replace(/\/$/, '')}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({ model, messages: [{role:'system', content: sys}, {role:'user', content: user}], temperature: 0.2 })
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || '';
      const jsonText = extractJson(content);
      if (!jsonText) return null;
      const obj = JSON.parse(jsonText);
      // Basic validation and clamping
      const bd = obj.breakdown || {};
      const clamp = (n)=>Math.max(0, Math.min(100, Math.round(Number(n)||0)));
      const result = {
        overall: clamp(obj.overall),
        clarity: clamp(bd.clarity),
        execution: clamp(bd.execution),
        planning: clamp(bd.planning),
        resources: clamp(bd.resources),
        feedback: clamp(bd.feedback),
        ideal: String(obj.ideal || ''),
        gaps: Array.isArray(obj.gaps) ? obj.gaps.map(String).slice(0,5) : [],
        actions: Array.isArray(obj.actions) ? obj.actions.map(String).slice(0,6) : []
      };
      // Minimal sanity: require some text
      if (!result.ideal && result.actions.length === 0 && result.gaps.length === 0) return null;
      return result;
    } catch (e) {
      console.warn('Full API evaluation error:', e);
      return null;
    }
  }

  function extractJson(text){
    // Try to find the first {...} block
    const m = text.match(/\{[\s\S]*\}/);
    return m ? m[0] : null;
  }

  // ---------- Render ----------
  function renderResult({ category, overall, clarity, execution, planning, resources, feedback, ideal, gaps, actions, debug }) {
    resultsEl.classList.remove('hidden');
    const delays = computeDelays({ overall, clarity, execution, planning, resources, feedback });
    // 遅延掲示板とスコアバー
    const line = lineLabel(category);
    if (lineLabelEl) lineLabelEl.textContent = line;
    delayStatusEl.textContent = `${line}: ${categoryLabel(category)}の実行に ${delays.overall} 分の遅延が発生しています。`;
    delayStatusEl.classList.remove('ok','warn','alert');
    if (delays.overall <= 10) delayStatusEl.classList.add('ok');
    else if (delays.overall <= 30) delayStatusEl.classList.add('warn');
    else delayStatusEl.classList.add('alert');
    scoreNumberEl.textContent = `${delays.overall}分`;
    scoreBarEl.style.width = `${overall}%`;

    idealEl.textContent = ideal;

    gapsEl.innerHTML = '';
    gaps.forEach(g => {
      const li = document.createElement('li');
      li.textContent = g;
      gapsEl.appendChild(li);
    });

    actionsEl.innerHTML = '';
    actions.forEach(a => {
      const li = document.createElement('li');
      li.textContent = a;
      actionsEl.appendChild(li);
    });

    breakdownEl.innerHTML = '';
    const shares = allocateDelay(delays.overall, { overall, clarity, execution, planning, resources, feedback });
    const pairs = [
      ['目標の明確さ', clarity, shares.clarity],
      ['実行・継続', execution, shares.execution],
      ['計画・一貫性', planning, shares.planning],
      ['リソース整備', resources, shares.resources],
      ['記録・振り返り', feedback, shares.feedback]
    ];
    pairs.forEach(([k, v, d]) => {
      const li = document.createElement('li');
      li.textContent = `${k}: 遅延 ${d}分（スコア ${v}）`;
      breakdownEl.appendChild(li);
    });

    debugEl.textContent = debug;

    // SE
    if (delays.overall <= 10) playSE('ok');
    else if (delays.overall <= 30) playSE('warn');
    else playSE('alert');

    // 遅延証明（擬似）
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth()+1).padStart(2,'0');
    const d = String(now.getDate()).padStart(2,'0');
    const hh = String(now.getHours()).padStart(2,'0');
    const mm = String(now.getMinutes()).padStart(2,'0');
    const cert = [
      `【遅延証明（擬似）】`,
      `${y}年${m}月${d}日 ${hh}:${mm} 現在`,
      `${line} において ${delays.overall} 分の遅延が発生していることを確認しました。`,
      `要因（上位）: ${gaps.slice(0,2).join(' / ') || '解析中'}`,
      `短縮プラン: ${actions[0] || '—'}`,
      `※本証明は学習用の擬似表示です。実際の鉄道運行とは無関係です。`
    ].join('\n');
    if (certTextEl) certTextEl.textContent = cert;
  }

  function saveLast(input, category, computed) {
    const payload = { input, category, computed, ts: Date.now() };
    try { localStorage.setItem('risou_adviser_last', JSON.stringify(payload)); } catch {}
  }
  function loadLast() {
    try {
      const raw = localStorage.getItem('risou_adviser_last');
      if (!raw) return null;
      return JSON.parse(raw);
    } catch { return null; }
  }

  // ---------- Events ----------
  analyzeBtn.addEventListener('click', async () => {
    const context = normalize(contextEl.value);
    if (!context) {
      alert('現状を入力してください');
      contextEl.focus();
      return;
    }
    analyzeBtn.disabled = true;
    analyzeBtn.textContent = '分析中...';
    try {
      const category = detectCategory(context, categoryEl.value);
      const mode = (apiModeEl?.value || 'assist');

      let s, ideal, gaps, actions, debug;

      if (useApiEl.checked && mode === 'full' && apiKeyEl.value.trim() && apiBaseEl.value.trim()) {
        const apiRes = await apiFullEvaluate(context, category);
        if (apiRes) {
          s = { overall: apiRes.overall, clarity: apiRes.clarity, execution: apiRes.execution, planning: apiRes.planning, resources: apiRes.resources, feedback: apiRes.feedback, flags: {}, numbers: [] };
          ideal = apiRes.ideal || buildIdeal(category, s, context);
          gaps = apiRes.gaps?.length ? apiRes.gaps : buildGaps(s);
          actions = apiRes.actions?.length ? apiRes.actions : buildActions(category, s);
          debug = `カテゴリ: ${category}\nスコア(API): ${JSON.stringify(s, null, 2)}\nAPIモード: full`;
          renderResult({ category, overall: s.overall, clarity: s.clarity, execution: s.execution, planning: s.planning, resources: s.resources, feedback: s.feedback, ideal, gaps, actions, debug });
          saveLast(context, category, s);
          return;
        }
        // API failed → fall through to local
      }

      // Local evaluation
      s = computeScores(context);
      ideal = buildIdeal(category, s, context);
      gaps = buildGaps(s);
      actions = buildActions(category, s);

      // Optional API augmentation (assist mode)
      let apiText = null;
      if (useApiEl.checked && mode === 'assist') {
        apiText = await tryApi(context, category, s);
      }
      debug = `カテゴリ: ${category}\nスコア(ローカル): ${JSON.stringify(s, null, 2)}\nAPI補足: ${!!apiText}`;
      if (apiText) {
        actions.push('—');
        actions.push('APIからの追加提案:');
        actions.push(apiText.replace(/\n/g, ' ').slice(0, 300));
      }

      renderResult({ category, overall: s.overall, clarity: s.clarity, execution: s.execution, planning: s.planning, resources: s.resources, feedback: s.feedback, ideal, gaps, actions, debug });
      saveLast(context, category, s);
    } finally {
      analyzeBtn.disabled = false;
      analyzeBtn.textContent = '分析する';
    }
  });

  clearBtn.addEventListener('click', () => {
    contextEl.value = '';
    resultsEl.classList.add('hidden');
  });

  loadLastBtn.addEventListener('click', () => {
    const last = loadLast();
    if (!last) { alert('保存された結果はありません'); return; }
    contextEl.value = last.input;
    categoryEl.value = last.category;
    const s = last.computed;
    const ideal = buildIdeal(last.category, s, last.input);
    const gaps = buildGaps(s);
    const actions = buildActions(last.category, s);
    renderResult({ category: last.category, overall: s.overall, clarity: s.clarity, execution: s.execution, planning: s.planning, resources: s.resources, feedback: s.feedback, ideal, gaps, actions, debug: `前回の結果を表示` });
  });

  // 証明のコピー/印刷
  if (copyCertBtn) {
    copyCertBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(certTextEl.textContent || '');
        copyCertBtn.textContent = 'コピーしました';
        setTimeout(()=>copyCertBtn.textContent='内容をコピー', 1200);
      } catch {}
    });
  }
  if (printBtn) {
    printBtn.addEventListener('click', () => window.print());
  }
})();
