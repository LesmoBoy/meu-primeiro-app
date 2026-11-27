/* Orçamento conservador de cópias novas, sem ler armazenamento ou alterar dados.
 * O servidor usa octet_length(jsonb::text), não o tamanho do JSON compacto.
 * A validação do formato e a autorização continuam pertencendo a seus módulos. */
(function (root) {
  'use strict';

  const LIMIT_BYTES = 5 * 1024 * 1024;
  const MAX_DEPTH = 128;
  const MAX_NODES = 4000000;
  const MAX_WORK_BYTES = LIMIT_BYTES * 4;
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

  class BudgetError extends Error {
    constructor(code, message, budget) {
      super(message);
      this.name = 'RodagemBackupBudgetError';
      this.code = code;
      this.budget = budget;
    }
  }

  function invalid(reason) {
    return Object.freeze({wireBytes:null, serverBytesUpperBound:null,
      limitBytes:LIMIT_BYTES, fits:false, reason, complete:false});
  }

  // Both JSON.stringify and PostgreSQL JSONB escape these characters alike.
  // PostgreSQL JSONB rejects NUL and unpaired UTF-16 surrogates instead of
  // preserving JavaScript's replacement/escape representation.
  function stringBytes(value) {
    let bytes = 2;
    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index);
      if (code === 0) return null;
      if (code === 34 || code === 92) bytes += 2;
      else if (code === 8 || code === 9 || code === 10 || code === 12 || code === 13) bytes += 2;
      else if (code < 32) bytes += 6;
      else if (code < 128) bytes++;
      else if (code < 2048) bytes += 2;
      else if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(index + 1);
        if (!(next >= 0xdc00 && next <= 0xdfff)) return null;
        bytes += 4;
        index++;
      } else if (code >= 0xdc00 && code <= 0xdfff) return null;
      else bytes += 3;
    }
    return bytes;
  }

  // JSON.stringify uses exponent notation for some finite doubles. JSONB's
  // numeric output expands that token in decimal notation. Calculate the
  // length without allocating potentially long strings of zeros.
  function numberBytes(value) {
    if (!Number.isFinite(value)) return null;
    const token = JSON.stringify(value);
    if (!/[eE]/.test(token)) return {wire:token.length, server:token.length};
    const parts = /^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(token);
    if (!parts) return null;
    const sign = parts[1].length;
    const digits = parts[2].length + (parts[3] || '').length;
    const point = parts[2].length + Number(parts[4]);
    const server = point <= 0 ? 2 - point + digits + sign
      : point >= digits ? point + sign : digits + 1 + sign;
    return {wire:token.length, server:Math.max(token.length, server)};
  }

  function plain(value) {
    const prototype = Object.getPrototypeOf(value);
    if (prototype === null) return true;
    // This also accepts ordinary objects from a different JS realm.
    return Object.getPrototypeOf(prototype) === null;
  }

  function hasSerializationHook(value) {
    let item = value;
    while (item !== null) {
      const descriptor = Object.getOwnPropertyDescriptor(item,'toJSON');
      if (descriptor) return !own(descriptor,'value') || typeof descriptor.value === 'function';
      item = Object.getPrototypeOf(item);
    }
    return false;
  }

  function inspect(value) {
    let wire = 0, server = 0, nodes = 0;
    const active = new WeakSet();
    // A cursor per container keeps memory proportional to depth, even for a
    // large flat ledger. Aliased objects are allowed; circular paths are not.
    const frames = [{value, depth:0, entered:false}];
    function add(wireBytes, serverBytes = wireBytes) {
      wire += wireBytes;
      server += serverBytes;
    }
    try {
      while (frames.length) {
        const frame = frames[frames.length - 1];
        if (!frame.entered) {
          if (++nodes > MAX_NODES || wire > MAX_WORK_BYTES || server > MAX_WORK_BYTES) return invalid('complexity');
          const item = frame.value;
          if (item === null) { add(4); frames.pop(); continue; }
          if (typeof item === 'boolean') { add(item ? 4 : 5); frames.pop(); continue; }
          if (typeof item === 'number') {
            const bytes = numberBytes(item);
            if (!bytes) return invalid('invalid-json');
            add(bytes.wire,bytes.server); frames.pop(); continue;
          }
          if (typeof item === 'string') {
            const bytes = stringBytes(item);
            if (bytes === null) return invalid('invalid-unicode');
            add(bytes); frames.pop(); continue;
          }
          if (typeof item !== 'object') return invalid('invalid-json');
          if (frame.depth >= MAX_DEPTH) return invalid('depth');
          if (active.has(item)) return invalid('circular');
          const array = Array.isArray(item);
          if (!array && !plain(item) || hasSerializationHook(item)) return invalid('invalid-json');
          frame.array = array;
          frame.keys = array ? null : Object.keys(item);
          frame.length = array ? item.length : frame.keys.length;
          frame.index = 0;
          frame.entered = true;
          active.add(item);
          add(2);
          if (frame.length > 1) add(frame.length - 1,(frame.length - 1) * 2);
        }
        if (frame.index >= frame.length) {
          active.delete(frame.value); frames.pop(); continue;
        }
        const key = frame.array ? String(frame.index) : frame.keys[frame.index];
        frame.index++;
        const descriptor = Object.getOwnPropertyDescriptor(frame.value,key);
        // Getters, holes, functions, symbols and undefined are not a canonical
        // JSON copy. Never invoke application code or silently omit such data.
        if (!descriptor || !own(descriptor,'value')) return invalid('invalid-json');
        if (!frame.array) {
          const bytes = stringBytes(key);
          if (bytes === null) return invalid('invalid-unicode');
          add(bytes + 1,bytes + 2);
        }
        frames.push({value:descriptor.value, depth:frame.depth + 1, entered:false});
      }
    } catch {
      return invalid('invalid-json');
    }
    const fits = wire <= LIMIT_BYTES && server <= LIMIT_BYTES;
    return Object.freeze({wireBytes:wire, serverBytesUpperBound:server,
      limitBytes:LIMIT_BYTES, fits, reason:fits ? 'ok' : 'server-limit', complete:true});
  }

  function assertFits(value) {
    const budget = inspect(value);
    if (budget.fits) return budget;
    if (budget.reason === 'server-limit') {
      throw new BudgetError('BACKUP_TOO_LARGE',
        'A cópia ultrapassa o limite seguro de 5 MiB no servidor. O JSONB pode ocupar mais espaço que o arquivo JSON. Exporte percursos antigos em GPX ou reduza a cópia antes de enviar. A última cópia válida e os dados deste aparelho foram mantidos.',budget);
    }
    const reason = budget.reason === 'invalid-unicode' ? 'A cópia contém caracteres incompatíveis com o banco.'
      : budget.reason === 'depth' || budget.reason === 'complexity' ? 'A estrutura da cópia excede os limites seguros de processamento.'
      : 'A cópia contém dados que não podem ser enviados como JSON seguro.';
    throw new BudgetError('BACKUP_INVALID_DATA',reason + ' Nada foi enviado; os dados deste aparelho e a última cópia válida foram mantidos.',budget);
  }

  root.RodagemBackupBudget = Object.freeze({inspect,assertFits,limitBytes:LIMIT_BYTES});
})(typeof window === 'undefined' ? globalThis : window);
