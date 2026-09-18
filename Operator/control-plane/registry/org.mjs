// Operators and Businesses — the two levels above a project (R1).
// Every read takes the caller's scope and names it in the query.
import { query } from './db.mjs';
import { scopeFilter, canReachOperator, canReachBusiness, isPlatform } from '../lib/scope.mjs';

/** URL-safe identifier from a display name ("Acme Co" -> "acme-co"). */
export const slugify = (s) =>
  String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

function cleanName(name) {
  const n = String(name || '').trim();
  if (!n) throw new Error('A name is required');
  if (n.length > 120) throw new Error('Name is too long');
  return n;
}

async function uniqueSlug(table, wanted) {
  const base = slugify(wanted);
  if (!base) throw new Error('The name needs at least one letter or digit');
  for (let i = 0; i < 50; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    const { rows } = await query(`select 1 from siteagent_control.${table} where slug = $1`, [slug]);
    if (!rows.length) return slug;
  }
  throw new Error('Could not find a free identifier for that name');
}

// ---- Operators ---------------------------------------------------------------

// Every operator read names its columns rather than using `*`: the branding
// artwork is bytea, and megabytes of PNG have no business riding along with a
// listing that wanted names. What callers actually need is whether a logo
// exists, so that comes back as a flag; the bytes are read one at a time, by
// the route that serves them.
// Takes the table alias, because one of these reads joins businesses, where a
// bare `id` would be ambiguous.
const operatorCols = (alias = '') => {
  const p = alias ? `${alias}.` : '';
  return `${p}id, ${p}slug, ${p}name, ${p}created_at, ${p}updated_at,
         ${p}brand_name, ${p}brand_accent, ${p}brand_version,
         (${p}logo_blob is not null)      as has_logo,
         (${p}logo_dark_blob is not null) as has_logo_dark,
         (${p}icon_blob is not null)      as has_icon`;
};
const OPERATOR_COLS = operatorCols();

export async function listOperators(scope) {
  if (isPlatform(scope)) {
    const { rows } = await query(`select ${OPERATOR_COLS} from siteagent_control.operators order by name`);
    return rows;
  }
  if (scope.level === 'operator') {
    const { rows } = await query(`select ${OPERATOR_COLS} from siteagent_control.operators where id = $1`, [scope.operatorId]);
    return rows;
  }
  // A Business admin sees its own Operator's name only through its Business.
  const { rows } = await query(
    `select ${operatorCols('o')} from siteagent_control.operators o
       join siteagent_control.businesses b on b.operator_id = o.id
      where b.id = $1`,
    [scope.businessId],
  );
  return rows;
}

export async function getOperatorInScope(scope, id) {
  if (!canReachOperator(scope, id)) return null;
  const { rows } = await query(`select ${OPERATOR_COLS} from siteagent_control.operators where id = $1`, [id]);
  return rows[0] || null;
}

export async function createOperator(scope, { name, slug }) {
  if (!isPlatform(scope)) throw Object.assign(new Error('Only platform administrators can create operators'), { status: 403 });
  const n = cleanName(name);
  const s = await uniqueSlug('operators', slug || n);
  const { rows } = await query(
    `insert into siteagent_control.operators (slug, name) values ($1, $2) returning ${OPERATOR_COLS}`,
    [s, n],
  );
  return rows[0];
}

/** Rename an Operator (platform administrators only). */
export async function updateOperator(scope, id, { name }) {
  if (!isPlatform(scope)) throw Object.assign(new Error('Only platform administrators can rename operators'), { status: 403 });
  const op = await getOperatorInScope(scope, id);
  if (!op) throw Object.assign(new Error('not found'), { status: 404 });
  const { rows } = await query(
    `update siteagent_control.operators set name = $2, updated_at = now() where id = $1 returning ${OPERATOR_COLS}`,
    [op.id, cleanName(name)],
  );
  return rows[0];
}

export async function getOperatorBySlug(slug) {
  const { rows } = await query(`select ${OPERATOR_COLS} from siteagent_control.operators where slug = $1`, [slug]);
  return rows[0] || null;
}

// ---- Operator branding (R5) ---------------------------------------------------

/**
 * Save an Operator's branding. A platform administrator or that Operator's own
 * administrators may do it; a Business administrator may not (it does not own
 * the brand its projects wear).
 *
 * Each artwork is three-valued on purpose: `undefined` leaves it alone,
 * `null` clears it back to the platform's, and a buffer replaces it. Every
 * save bumps brand_version, which is what lets a cached logo or favicon be
 * replaced in a browser that has already seen the old one.
 */
export async function saveOperatorBrand(scope, id, patch = {}) {
  if (!canReachOperator(scope, id)) throw Object.assign(new Error('not found'), { status: 404 });
  if (scope.level === 'business') {
    throw Object.assign(new Error('Business administrators cannot change branding'), { status: 403 });
  }
  const sets = ['updated_at = now()', 'brand_version = brand_version + 1'];
  const params = [id];
  const put = (sql, value) => {
    params.push(value);
    sets.push(sql.replace('$n', `$${params.length}`));
  };
  if (patch.brandName !== undefined) put('brand_name = $n', patch.brandName || null);
  if (patch.accent !== undefined) put('brand_accent = $n', patch.accent || null);
  for (const [key, blobCol, mimeCol] of [
    ['logo', 'logo_blob', 'logo_mime'],
    ['logoDark', 'logo_dark_blob', 'logo_dark_mime'],
    ['icon', 'icon_blob', 'icon_mime'],
  ]) {
    if (patch[key] === undefined) continue;
    put(`${blobCol} = $n`, patch[key] ? patch[key].bytes : null);
    put(`${mimeCol} = $n`, patch[key] ? patch[key].mime : null);
  }
  const { rows } = await query(
    `update siteagent_control.operators set ${sets.join(', ')} where id = $1 returning ${OPERATOR_COLS}`,
    params,
  );
  if (!rows[0]) throw Object.assign(new Error('not found'), { status: 404 });
  return rows[0];
}

/** One piece of artwork, read only when it is about to be served. */
export async function readOperatorArtwork(id, kind) {
  const col = { logo: 'logo', logoDark: 'logo_dark', icon: 'icon' }[kind];
  if (!col) return null;
  const { rows } = await query(
    `select ${col}_blob as bytes, ${col}_mime as mime, brand_version from siteagent_control.operators where id = $1`,
    [id],
  );
  const row = rows[0];
  return row && row.bytes ? { bytes: row.bytes, mime: row.mime, version: row.brand_version } : null;
}

/** The branding fields for one Operator, with no scope check: brand is public. */
export async function readOperatorBrandRow(id) {
  if (id === null || id === undefined) return null;
  const { rows } = await query(
    `select id, slug, name, brand_name, brand_accent, brand_version,
            (logo_blob is not null)      as has_logo,
            (logo_dark_blob is not null) as has_logo_dark,
            (icon_blob is not null)      as has_icon
       from siteagent_control.operators where id = $1`,
    [id],
  );
  return rows[0] || null;
}

// ---- Businesses --------------------------------------------------------------

export async function listBusinesses(scope) {
  const f = scopeFilter(scope, 'b');
  // For a Business admin the filter is on the business itself (its id).
  const where = scope.level === 'business' ? 'b.id = $1' : f.sql;
  const params = scope.level === 'business' ? [scope.businessId] : f.params;
  const { rows } = await query(
    `select b.*, o.name as operator_name, o.slug as operator_slug
       from siteagent_control.businesses b
       left join siteagent_control.operators o on o.id = b.operator_id
      where ${where}
      order by b.name`,
    params,
  );
  return rows;
}

export async function getBusiness(id) {
  if (!/^\d+$/.test(String(id ?? ''))) return null;
  const { rows } = await query(
    `select b.*, o.name as operator_name, o.slug as operator_slug
       from siteagent_control.businesses b
       left join siteagent_control.operators o on o.id = b.operator_id
      where b.id = $1`,
    [id],
  );
  return rows[0] || null;
}

export async function getBusinessInScope(scope, id) {
  const b = await getBusiness(id);
  return b && canReachBusiness(scope, b) ? b : null;
}

export async function getBusinessBySlug(slug) {
  const { rows } = await query('select * from siteagent_control.businesses where slug = $1', [slug]);
  return rows[0] || null;
}

/**
 * Create a Business. The platform may place it under any Operator (or none);
 * an Operator admin only under its own Operator; a Business admin not at all.
 */
export async function createBusiness(scope, { name, slug, operatorId }) {
  const n = cleanName(name);
  let opId = operatorId === undefined || operatorId === null || operatorId === '' ? null : String(operatorId);
  if (scope.level === 'business') {
    throw Object.assign(new Error('Business administrators cannot create businesses'), { status: 403 });
  }
  if (scope.level === 'operator') {
    opId = opId ?? scope.operatorId;
    if (opId !== scope.operatorId) throw Object.assign(new Error('Not your operator'), { status: 403 });
  }
  if (opId !== null && !(await getOperatorInScope(scope, opId))) {
    throw Object.assign(new Error('Unknown operator'), { status: 404 });
  }
  const s = await uniqueSlug('businesses', slug || n);
  const { rows } = await query(
    'insert into siteagent_control.businesses (slug, name, operator_id) values ($1, $2, $3) returning *',
    [s, n, opId],
  );
  return rows[0];
}

/** The Business the Connector creates sites under, made on first use. */
export async function connectorBusiness() {
  await query(
    `insert into siteagent_control.businesses (slug, name) values ('connector-sites', 'Connector sites')
     on conflict (slug) do nothing`,
  );
  return getBusinessBySlug('connector-sites');
}

/**
 * Rename a Business, or (platform only) move it under another Operator.
 * `operatorId: null` makes it direct.
 */
export async function updateBusiness(scope, id, { name, operatorId }) {
  const b = await getBusinessInScope(scope, id);
  if (!b) throw Object.assign(new Error('not found'), { status: 404 });
  const sets = [];
  const params = [];
  if (name !== undefined) {
    params.push(cleanName(name));
    sets.push(`name = $${params.length}`);
  }
  if (operatorId !== undefined) {
    if (!isPlatform(scope)) {
      throw Object.assign(new Error('Only platform administrators can move a business'), { status: 403 });
    }
    const opId = operatorId === null || operatorId === '' ? null : String(operatorId);
    if (opId !== null && !(await getOperatorInScope(scope, opId))) {
      throw Object.assign(new Error('Unknown operator'), { status: 404 });
    }
    params.push(opId);
    sets.push(`operator_id = $${params.length}`);
  }
  if (!sets.length) return b;
  params.push(b.id);
  const { rows } = await query(
    `update siteagent_control.businesses set ${sets.join(', ')}, updated_at = now()
      where id = $${params.length} returning *`,
    params,
  );
  return rows[0];
}

// ---- The chain (AC-A1.1) -------------------------------------------------------

/**
 * Operators → Businesses → projects, limited to the scope. Direct Businesses
 * (no Operator) are listed under `direct`.
 */
export async function orgTree(scope) {
  const [operators, businesses] = await Promise.all([listOperators(scope), listBusinesses(scope)]);
  const t = scopeFilter(scope, 't');
  const { rows: projects } = await query(
    `select t.slug, t.display_name, t.status, t.tier, t.business_id, t.operator_id
       from siteagent_control.tenants t
      where t.status <> 'removed' and ${t.sql}
      order by coalesce(t.display_name, t.slug)`,
    t.params,
  );
  const projectsOf = (bid) =>
    projects
      .filter((p) => String(p.business_id) === String(bid))
      .map((p) => ({ slug: p.slug, name: p.display_name || p.slug, status: p.status, tier: p.tier }));
  const businessView = (b) => ({
    id: String(b.id), slug: b.slug, name: b.name,
    operatorId: b.operator_id === null ? null : String(b.operator_id),
    projects: projectsOf(b.id),
  });
  return {
    operators: operators.map((o) => ({
      id: String(o.id), slug: o.slug, name: o.name,
      businesses: businesses.filter((b) => String(b.operator_id) === String(o.id)).map(businessView),
    })),
    direct: businesses.filter((b) => b.operator_id === null).map(businessView),
    // Businesses under an Operator this scope cannot see as a whole (a
    // Business admin's own Business, when it has an Operator).
    other: businesses
      .filter((b) => b.operator_id !== null && !operators.some((o) => String(o.id) === String(b.operator_id)))
      .map(businessView),
  };
}
