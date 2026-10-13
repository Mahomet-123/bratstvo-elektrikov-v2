/**
 * ============================================================================
 * Модуль: estimate
 * Ответственность: живой предпросмотр расчёта на телефоне — те же правила,
 *                  что применяет сервер: коэффициенты, наценка «снабжение
 *                  материалом», пусконаладка, скидка. Нужен только для показа
 *                  итога при вводе; окончательные числа всегда приходят с сервера.
 * Зависимости: нет
 * ============================================================================
 */

/** Правила расчёта по умолчанию — совпадают с настройками бэкенда. */
export const ESTIMATE_RULES = {
  supplyPercent: 10,
  supplyMin: 1500,
  commissioningPercent: 30,
  maxDiscountPercent: 100,
  defaultCoeff: 1
};

/**
 * Округление до копеек — как на сервере.
 * @param {number} value
 * @return {number}
 */
export function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/**
 * Положительное число с запасным значением.
 * @param {*} value
 * @param {number} fallback
 * @return {number}
 */
function positive(value, fallback) {
  const n = Number(value);
  if (!isFinite(n) || n <= 0) return fallback;
  return n;
}

/**
 * Пересчёт расчёта по строкам и параметрам.
 * @param {Array<Object>} rows — { price, qty, coeff }
 * @param {Object} params — { coefficient, materialCost, equipmentCost, discount, discountType }
 * @param {Object=} rules — правила из прайса (supplyPercent и прочее)
 * @return {Object} подробный итог
 */
export function computeEstimate(rows, params, rules) {
  const r = Object.assign({}, ESTIMATE_RULES, rules || {});
  const p = params || {};

  const globalCoeff = positive(p.coefficient, r.defaultCoeff);

  const list = (rows || []).map((row) => {
    const price = round2(Number(row.price) || 0);
    const qty = Number(row.qty) || 0;
    const coeff = positive(row.coeff, globalCoeff);
    return {
      id: row.id,
      section: row.section || '',
      position: Number(row.position) || 0,
      name: row.name || '',
      unit: row.unit || '',
      price: price,
      qty: qty,
      coeff: coeff,
      sum: round2(price * qty * coeff),
      note: row.note || ''
    };
  });

  const subtotal = round2(list.reduce((acc, row) => acc + row.sum, 0));

  const materialCost = round2(Number(p.materialCost) || 0);
  const supply = materialCost > 0
    ? Math.max(round2(materialCost * r.supplyPercent / 100), r.supplyMin)
    : 0;

  const equipmentCost = round2(Number(p.equipmentCost) || 0);
  const commissioning = equipmentCost > 0
    ? round2(equipmentCost * r.commissioningPercent / 100)
    : 0;

  const beforeDiscount = round2(subtotal + supply + commissioning);

  const discountType = p.discountType === 'percent' ? 'percent' : 'sum';
  const discountValue = Number(p.discount) || 0;
  let discount = 0;
  if (discountValue > 0) {
    discount = discountType === 'percent'
      ? round2(beforeDiscount * Math.min(discountValue, r.maxDiscountPercent) / 100)
      : Math.min(round2(discountValue), beforeDiscount);
  }

  const total = round2(beforeDiscount - discount);

  return {
    rows: list,
    positions: list.length,
    coefficient: globalCoeff,
    subtotal: subtotal,
    materialCost: materialCost,
    equipmentCost: equipmentCost,
    supply: supply,
    supplyPercent: r.supplyPercent,
    supplyMin: r.supplyMin,
    commissioning: commissioning,
    commissioningPercent: r.commissioningPercent,
    beforeDiscount: beforeDiscount,
    discount: discount,
    discountValue: discountValue,
    discountType: discountType,
    total: total
  };
}

export default computeEstimate;
