/* All words on screen. The trace holds facts; this file turns them into plain English without adding any. */
(function () {
  'use strict';
  var ATN = window.ATN;
  var usd = ATN.usd;
  var copy = (ATN.copy = {});

  var WORKER_NAME = { scraper: 'the scraper', datasci: 'the data scientist', attacker: 'the unlisted agent' };
  var WORKER_SHORT = { scraper: 'scraper', datasci: 'data scientist', attacker: 'unlisted agent' };
  copy.workerName = function (k) { return WORKER_NAME[k] || k; };
  copy.workerShort = function (k) { return WORKER_SHORT[k] || k; };

  var LAYER = {
    1: 'Layer 1 · Proof-of-Agent',
    2: 'Layer 2 · Neural Streaming',
    3: 'Layer 3 · VeriPay Escrow',
  };

  function one(layer, head, sub, eyebrow) {
    return { layer: layer, eyebrow: eyebrow || (layer ? LAYER[layer] : ''), phases: [{ at: 0, head: head, sub: sub }] };
  }
  function two(layer, a, b) {
    return { layer: layer, eyebrow: layer ? LAYER[layer] : '', phases: [{ at: 0, head: a[0], sub: a[1] }, { at: 0.5, head: b[0], sub: b[1] }] };
  }

  /** What the person sees before the first step. */
  copy.intro = function (trace) {
    return {
      layer: null,
      eyebrow: 'Autonomous Trust Network',
      phases: [{
        at: 0,
        head: 'AI agents are about to spend real money. What stops them when they’re tricked?',
        sub: trace.tagline + ' Press play.',
      }],
    };
  };

  copy.narrate = function (trace, beat) {
    var d = beat.data;
    var st = beat.state;
    switch (beat.kind) {
      case 'delegation': {
        var min = d.minCounterpartyTrust ? ', and never a worker whose trust score is under ' + d.minCounterpartyTrust : '';
        return one(1,
          'You give an AI agent a ' + usd(d.ceiling) + ' budget. Not your card.',
          'You sign a permission slip: pay only these ' + d.counterparties.length + ' workers, up to ' + usd(d.ceiling) + ', for ' + Math.round(d.expiresInMs / 60000) + ' minutes' + min + '. The agent holds the slip, never your card.');
      }
      case 'vault_open':
        return one(1,
          usd(d.funded) + ' is set aside in a vault. The clock starts.',
          'After ' + Math.round(d.ttlMs / 60000) + ' minutes it closes by itself. Your funding details are committed as a hash, so the agent never handles them.');
      case 'list_workers':
        return one(1,
          'The agent shops for workers.',
          'A web scraper at $0.0002 a page, and a data scientist who is paid through escrow. Only these two are on the slip.');
      case 'open_channel': {
        var key = beat.target;
        if (beat.ok) {
          return one(2,
            'It opens a pay-per-page tab with ' + copy.workerName(key) + ', capped at ' + usd(d.ceiling) + '.',
            'That cap is held back from the vault, so the same dollars can’t be spent twice.');
        }
        var req = beat.requests[0];
        if (req.code === 'COUNTERPARTY_DENIED') {
          return two(1,
            [d.cause === 'injection' ? 'The agent obeys the page and tries to pay a stranger ' + usd(d.ceiling) + '.' : 'The agent tries to pay someone off the list.',
              'It opens a tab to ' + d.worker + '. That agent never appeared on your permission slip.'],
            ['Denied. The slip says who can be paid.',
              'COUNTERPARTY_DENIED. The agent’s judgment never mattered: the server checks every payment itself.']);
        }
        if (req.code === 'CEILING_EXCEEDS_VAULT') {
          return two(1,
            ['It tries again, this time with a ' + usd(d.ceiling) + ' tab.', 'That is far more than the vault holds.'],
            ['Denied. The cap holds.', 'CEILING_EXCEEDS_VAULT. ' + ATN.humanize(req.detail || '')]);
        }
        return two(1, ['The agent tries to open a tab.', ''], ['Refused.', (req.code || '') + ' ' + ATN.humanize(req.detail || '')]);
      }
      case 'stream': {
        if (!beat.ok) {
          var r = beat.requests[0];
          return two(1,
            ['You pulled the plug. The agent keeps going.', 'It signs its next voucher as if nothing happened.'],
            ['Refused: the vault is closed.', (r.code || 'REJECTED') + '. The very first voucher after your revocation was rejected. ' + usd(d.from) + ' had been spent before that, and nothing more can be.']);
        }
        if (d.injected) {
          return one(2,
            'Pages stream in. Page 3 contains a trap.',
            'Each page is paid with a signed voucher: ' + usd(d.to) + ' so far. Hidden in the page text is an instruction aimed at the agent.');
        }
        return one(2,
          d.pages + ' pages stream in, each paid with a signed voucher.',
          'Vouchers add up off-ledger: ' + usd(d.to) + ' owed so far. Nothing has touched the payment ledger yet.');
      }
      case 'settle':
        return one(2,
          d.vouchers + ' micro-payments become one settlement: ' + usd(d.amount) + '.',
          'They never touched the payment ledger. The scraper submits one signed receipt and is paid once.' + (d.mode === 'SIMULATED' ? ' Settlement is simulated in this demo.' : ''));
      case 'escrow': {
        if (beat.ok) {
          return one(3,
            usd(d.amount) + ' for a custom model is locked in escrow.',
            'Held, not sent. The data scientist is paid only if the delivery passes inspection.');
        }
        var er = beat.requests[0];
        return two(3,
          ['The agent tries to hire the same data scientist again.', 'Another ' + usd(d.amount) + ' order.'],
          ['Refused. That worker has lost your trust.', (er.code || '') + '. ' + ATN.humanize(er.detail || '')]);
      }
      case 'inspect': {
        if (d.outcome === 'PASS') {
          return one(3,
            'Delivery inspected: PASS. ' + usd(d.amount) + ' released.',
            'The model file passed the structural checks, so the money moves. Worker trust ' + d.trustFrom + ' → ' + d.trustTo + '.');
        }
        var parts = [];
        d.reasons.forEach(function (x) {
          if (x.indexOf('FORBIDDEN_OP:') === 0) parts.push('a forbidden operator (' + x.split(':')[1] + ')');
          else if (x === 'MALFORMED_PROTOBUF') parts.push('a file that doesn’t parse as a model');
          else if (x === 'OVERSIZE') parts.push('a file over the size limit');
          else if (x === 'HASH_MISMATCH') parts.push('a hash that doesn’t match');
        });
        return one(3,
          'Delivery inspected: FAIL. ' + usd(d.amount) + ' is back in your vault.',
          'The delivery had ' + (parts.length ? parts.join(' and ') : 'a failing check') + '. Worker trust ' + d.trustFrom + ' → ' + d.trustTo + '.');
      }
      case 'revoke':
        return one(1,
          'You pull the plug.',
          'One signed revocation: the delegation is cancelled, held money is released, and the vault closes.');
      case 'say': {
        var said = d.text ? ' Agent’s own report: “' + d.text + '”' : '';
        var ch = st.channel;
        var heads = {
          'prompt-injection': ['The agent was fooled. The money wasn’t.', 'Only ' + usd(ch ? ch.spent : 0) + ' ever moved, for the pages it actually read.'],
          'happy-path': ['Data and a verified model, ' + usd(st.vault.committed) + ' in total.', 'Every dollar was capped, checked and accounted for.'],
          'bad-model': ['Bad delivery. No loss.', 'Only ' + usd(st.vault.committed) + ' was spent, on pages. The escrow came back whole.'],
          'revoked-mid-stream': ['The kill switch works mid-stream.', 'Spending froze at ' + usd(ch ? ch.spent : 0) + '.'],
          'trust-gate': ['Reputation has consequences.', 'The vault is whole again: ' + usd(st.vault.funded - st.vault.reserved - st.vault.committed) + ' available.'],
        };
        var h = heads[trace.scenario] || ['Done.', ''];
        return one(null, h[0], h[1] + said, 'Outcome');
      }
      default:
        return one(null, '', '');
    }
  };

  /** Short tool-call style label shown next to the acting node. */
  copy.tool = function (beat) {
    var d = beat.data;
    switch (beat.kind) {
      case 'delegation': return 'sign(slip: ' + usd(d.ceiling) + ', ' + d.counterparties.length + ' workers)';
      case 'vault_open': return 'open_vault(' + usd(d.funded) + ', ' + Math.round(d.ttlMs / 60000) + 'm)';
      case 'list_workers': return 'list_workers()';
      case 'open_channel': return 'open_channel(' + (beat.target === 'attacker' ? 'attacker' : beat.target) + ', ' + usd(d.ceiling) + ')';
      case 'stream': return 'stream_pages(' + d.pages + ')';
      case 'settle': return 'settle_channel()';
      case 'escrow': return 'create_escrow(' + beat.target + ', ' + usd(d.amount) + ')';
      case 'inspect': return 'deliver(model.onnx)';
      case 'revoke': return 'revoke(delegation)';
      default: return '';
    }
  };

  copy.actorNode = function (beat) {
    return { principal: 'human', buyer: 'buyer', scraper: 'scraper', datasci: 'datasci', attacker: 'attacker' }[beat.actor] || null;
  };

  /* Gateway checks, in the order the server evaluates them (src/http/routes.ts). Rows a request never reaches are dimmed. */
  var ORDER = ['Signature', 'Trust', 'Vault live', 'Ceiling', 'Allowlist'];
  var PROFILE = {
    '/v1/delegations': ['Signature'],
    '/v1/vaults': ['Signature'],
    '/v1/channels': ['Signature', 'Trust', 'Vault live', 'Ceiling', 'Allowlist'],
    '/v1/channels/:id/vouchers': ['Signature', 'Vault live', 'Ceiling'],
    '/v1/channels/:id/settle': ['Signature'],
    '/v1/escrows': ['Signature', 'Trust', 'Vault live', 'Ceiling'],
    '/v1/escrows/:id/fund': ['Signature'],
    '/v1/escrows/:id/inspect': ['Signature'],
    '/v1/delegations/:id/revoke': ['Signature'],
  };
  var CODE_CHECK = {
    FORGED_SIGNATURE: 'Signature', TAMPERED: 'Signature', REPLAYED: 'Signature',
    COUNTERPARTY_UNTRUSTED: 'Trust',
    VAULT_REVOKED: 'Vault live', VAULT_EXPIRED: 'Vault live', VAULT_CLOSED: 'Vault live',
    CEILING_EXCEEDS_VAULT: 'Ceiling', OVER_BUDGET: 'Ceiling',
    COUNTERPARTY_DENIED: 'Allowlist',
  };

  /** The decisive request of a beat: the first denial, else the last request. */
  copy.decisive = function (beat) {
    var reqs = beat.requests || [];
    for (var i = 0; i < reqs.length; i += 1) if (!reqs[i].ok) return reqs[i];
    return reqs[reqs.length - 1] || null;
  };

  /** Returns { order: [names evaluated, in order], states: {name: pass|fail|skip}, failAt }. */
  copy.gatewayChecks = function (trace, beat) {
    var req = copy.decisive(beat);
    if (!req) return null;
    var profile = (PROFILE[req.path] || ['Signature']).filter(function (n) {
      return n !== 'Trust' || (trace.delegation && trace.delegation.minCounterpartyTrust != null);
    });
    var failAt = req.ok ? null : (CODE_CHECK[req.code] && profile.indexOf(CODE_CHECK[req.code]) >= 0 ? CODE_CHECK[req.code] : profile[profile.length - 1]);
    var order = [];
    var states = {};
    ORDER.forEach(function (n) { states[n] = 'skip'; });
    for (var i = 0; i < profile.length; i += 1) {
      order.push(profile[i]);
      if (profile[i] === failAt) { states[profile[i]] = 'fail'; break; }
      states[profile[i]] = 'pass';
    }
    return { order: order, states: states, failAt: failAt, req: req };
  };

  copy.layerOf = function (trace, beat) { return copy.narrate(trace, beat).layer; };

  /* Log rows: one per request, or one muted row for steps that made no request. */
  copy.logRows = function (trace, beat) {
    var d = beat.data;
    var rows = [];
    var reqs = beat.requests || [];
    var signedBy = beat.actor === 'principal' ? 'signed by you (Ed25519)' : 'signed by ' + (d.worker && beat.kind !== 'settle' && beat.kind !== 'inspect' ? 'the agent' : beat.actor === 'buyer' ? 'the agent' : 'the worker') + ' (Ed25519)';
    var envelope = 'envelope: agent id · nonce · timestamp ± 60s · body sha256 · signature';

    if (!reqs.length) {
      if (beat.kind === 'list_workers') {
        rows.push({ verdict: 'info', label: 'agent', title: 'Looked up who it can hire', sub: d.workers.map(function (w) { return copy.workerShort(w.key) + ' (trust ' + w.trust + ')'; }).join(' · '), details: ['read only: no request, no money'] });
      } else if (beat.kind === 'say') {
        rows.push({ verdict: 'info', label: 'agent', title: 'Final report', sub: '“' + d.text + '”', details: [] });
      }
      return rows;
    }

    reqs.forEach(function (r) {
      var ok = r.ok;
      var row = { verdict: ok ? 'ok' : 'no', label: ok ? 'allowed' : 'denied', code: ok ? null : r.code, amount: '', title: '', sub: '', details: [] };
      var line = '<b>' + r.method + '</b> ' + r.path + ' → <b>' + r.status + '</b>' + (r.code ? ' ' + r.code : '');
      row.details.push(line);
      if (r.detail) row.details.push('detail: ' + r.detail);
      switch (r.path) {
        case '/v1/delegations':
          row.title = 'You signed the permission slip';
          row.amount = usd(d.ceiling);
          row.sub = 'allowlist: ' + d.counterparties.map(function (c) { return c.replace('agent:', ''); }).join(', ') + ' · ' + Math.round(d.expiresInMs / 60000) + ' min' + (d.minCounterpartyTrust ? ' · min trust ' + d.minCounterpartyTrust : '');
          row.details.push('scope: ' + d.scope.join(', ') + ' · ' + d.alg + ' signature by ' + d.signer);
          break;
        case '/v1/vaults':
          row.title = 'Vault opened and funded';
          row.amount = usd(d.funded);
          row.sub = 'closes by itself in ' + Math.round(d.ttlMs / 60000) + ' minutes';
          row.details.push('funding reference: sha256 commitment, not card details');
          break;
        case '/v1/channels':
          row.title = (ok ? 'Opened a tab with ' : 'Tried to open a tab with ') + copy.workerName(beat.target);
          row.amount = (ok ? 'cap ' : '') + usd(d.ceiling);
          if (!ok) row.sub = ATN.humanize(r.detail || '');
          else row.sub = 'held from the vault until settled';
          row.details.push(signedBy, envelope);
          break;
        case '/v1/channels/:id/vouchers':
          row.title = ok ? d.accepted + ' signed vouchers accepted' : 'Voucher refused';
          row.amount = ok ? usd(d.to - d.from) : '';
          row.sub = ok ? 'cumulative ' + usd(d.from) + ' → ' + usd(d.to) : ATN.humanize(r.detail || '');
          row.details.push('voucher: channelId · payee · cumulativeAmount · nonce · issuedAt · Ed25519', ok ? 'count: ' + (r.count || d.accepted) + ' · ' + usd(d.perPage) + ' each' : 'asked for ' + d.pages + ' pages, accepted 0');
          break;
        case '/v1/channels/:id/settle':
          row.title = 'Settled ' + usd(d.amount) + ' in one payment';
          row.amount = usd(d.amount);
          row.sub = d.vouchers + ' vouchers → 1 settlement · ' + d.mode;
          row.details.push('single settlement per channel, idempotency key per attempt');
          break;
        case '/v1/escrows':
          row.title = ok ? 'Escrow created' : 'Tried to create an escrow';
          row.amount = usd(d.amount);
          row.sub = ok ? usd(d.amount) + ' held from the vault' : ATN.humanize(r.detail || '');
          break;
        case '/v1/escrows/:id/fund':
          row.title = 'Escrow funded (held, not sent)';
          row.amount = usd(d.amount);
          row.sub = 'status FUNDED';
          break;
        case '/v1/escrows/:id/inspect':
          row.title = 'Delivery inspected: ' + d.outcome;
          row.amount = usd(d.amount);
          row.sub = d.outcome === 'PASS' ? 'released to the worker · trust ' + d.trustFrom + ' → ' + d.trustTo : 'refunded to the vault · trust ' + d.trustFrom + ' → ' + d.trustTo;
          row.details.push('reasons: ' + d.reasons.join(', '), 'artifact: ' + d.bytes + ' bytes · sha256 ' + ATN.shortHex(d.sha256));
          break;
        case '/v1/delegations/:id/revoke':
          row.title = 'You revoked the delegation';
          row.sub = 'held money released · vault REVOKED';
          break;
        default:
          row.title = r.method + ' ' + r.path;
      }
      if (r.path !== '/v1/delegations' && r.path !== '/v1/vaults' && r.path !== '/v1/delegations/:id/revoke' && row.details.indexOf(signedBy) < 0) row.details.push(signedBy);
      if (r.path === '/v1/delegations' || r.path === '/v1/vaults' || r.path === '/v1/delegations/:id/revoke') row.details.push(signedBy);
      rows.push(row);
    });
    return rows;
  };

  /** Invariants computed from the trace itself, so they hold for sample and engine traces alike. */
  copy.invariants = function (trace) {
    var beats = trace.beats;
    var over = beats.every(function (b) { return b.state.vault.reserved + b.state.vault.committed <= b.state.vault.funded; });
    var attacker = !beats.some(function (b) { return b.target === 'attacker' && b.ok && b.kind !== 'say'; });
    var cap = beats.every(function (b) { return !b.state.channel || b.state.channel.spent <= b.state.channel.ceiling; });
    var unchanged = beats.every(function (b, i) {
      if (b.ok || i === 0) return true;
      return JSON.stringify(b.state) === JSON.stringify(beats[i - 1].state);
    });
    var out = [];
    if (over) out.push('The vault was never over-committed.');
    if (attacker) out.push('Nothing was ever paid to the unlisted agent.');
    if (cap) out.push('No tab ever spent past its cap.');
    if (unchanged && beats.some(function (b) { return !b.ok; })) out.push('Every denied request changed nothing.');
    return out;
  };

  /* What is real and what is not: kept as data so it is easy to edit before a pitch. */
  copy.real = {
    built: [
      '<b>Signed permission slips.</b> The principal signs a delegation (Ed25519): ceiling, allowed workers, expiry, optional minimum worker trust.',
      '<b>Signed requests.</b> Every mutating call carries a nonce, a timestamp and a body hash, signed by the caller.',
      '<b>Vault accounting.</b> Money is reserved, then committed or released, atomically. It expires after 30 minutes and can be revoked.',
      '<b>Streaming channels.</b> Signed cumulative vouchers, replay and over-cap rejection, one settlement per channel.',
      '<b>Escrow.</b> Create, fund, inspect, then release or refund, with a trust score that moves on the result.',
      '<b>Five scenarios</b> with server-enforced invariants, runnable offline.',
      '<b>PayPal sandbox.</b> Order authorize, capture, refund, void and a payout batch ran against the sandbox on 7 Nov 2026 (<code>npm run paypal:smoke</code>).',
    ],
    next: [
      '<b>This screen replays recorded runs</b> and settlement is simulated. The sandbox run above is separate from the scenarios.',
      '<b>Zero-knowledge proofs are not built.</b> Today the proof is a signed delegation checked by the server.',
      '<b>The inspector is structural.</b> It checks the file format and scans for forbidden operators. It does not run the model or benchmark it yet.',
      '<b>The scenario agent is scripted.</b> It shows the server’s controls hold, not that a language model resists injection.',
      '<b>Allowlist on escrows.</b> The allowlist is enforced when a channel opens; escrow creation checks trust but not the allowlist yet.',
      '<b>Multi-process safety and live PayPal settlement</b> are not built.',
    ],
  };
})();
