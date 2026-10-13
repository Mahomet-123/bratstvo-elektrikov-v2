/**
 * ============================================================================
 * Модуль: Calc
 * Ответственность: расчёт стоимости работ по прайсу — применение коэффициентов,
 *                  наценок «снабжение материалом» и «пусконаладка», скидки,
 *                  сохранение и чтение расчёта объекта.
 *                  Итоги всегда пересчитываются на сервере: расчётам с телефона
 *                  доверять нельзя.
 * Зависимости: Config, Utils, Sheets, Prices, Objects, Sessions
 * ============================================================================
 */

/**
 * Пересчёт расчёта по строкам и параметрам.
 * @param {Array<Object>} rows — строки работ: { price, qty, coeff }
 * @param {Object} params — { coefficient, materialCost, equipmentCost, discount, discountType }
 * @return {Object} подробный итог
 */
function computeEstimate_(rows, params) {
  const p = params || {};
  const rules = CONFIG.CALC;

  const globalCoeff = num_(p.coefficient, 1) > 0 ? num_(p.coefficient, 1) : rules.DEFAULT_COEFF;
  const list = (rows || []).map(function (row) {
    const price = round2_(num_(row.price, 0));
    const qty = num_(row.qty, 0);
    const coeff = num_(row.coeff, 0) > 0 ? num_(row.coeff, 0) : globalCoeff;
    return {
      id: str_(row.id),
      section: str_(row.section),
      position: int_(row.position, 0),
      name: str_(row.name),
      unit: str_(row.unit),
      price: price,
      qty: qty,
      coeff: coeff,
      sum: round2_(price * qty * coeff),
      note: str_(row.note)
    };
  });

  const subtotal = round2_(list.reduce(function (acc, row) { return acc + row.sum; }, 0));

  // Снабжение материалом: 10% от стоимости материала, но не менее 1500 ₽.
  const material = round2_(num_(p.materialCost, 0));
  const supply = material > 0
    ? Math.max(round2_(material * rules.SUPPLY_PERCENT / 100), rules.SUPPLY_MIN)
    : 0;

  // Пусконаладка: 30% от стоимости оборудования.
  const equipment = round2_(num_(p.equipmentCost, 0));
  const commissioning = equipment > 0
    ? round2_(equipment * rules.COMMISSIONING_PERCENT / 100)
    : 0;

  const beforeDiscount = round2_(subtotal + supply + commissioning);

  // Скидка с итоговой суммы: либо процентом, либо фиксированной суммой.
  const discountType = str_(p.discountType) === 'percent' ? 'percent' : 'sum';
  let discount = 0;
  const rawDiscount = num_(p.discount, 0);
  if (rawDiscount > 0) {
    discount = discountType === 'percent'
      ? round2_(beforeDiscount * Math.min(rawDiscount, rules.MAX_DISCOUNT_PERCENT) / 100)
      : Math.min(round2_(rawDiscount), beforeDiscount);
  }

  const total = round2_(beforeDiscount - discount);

  return {
    rows: list,
    positions: list.length,
    coefficient: globalCoeff,
    subtotal: subtotal,
    materialCost: material,
    equipmentCost: equipment,
    supply: supply,
    supplyPercent: rules.SUPPLY_PERCENT,
    supplyMin: rules.SUPPLY_MIN,
    commissioning: commissioning,
    commissioningPercent: rules.COMMISSIONING_PERCENT,
    beforeDiscount: beforeDiscount,
    discount: discount,
    discountValue: rawDiscount,
    discountType: discountType,
    total: total
  };
}

/**
 * Параметры расчёта, сохранённые в карточке объекта.
 * @param {Object} object — строка листа «Объекты»
 * @return {Object}
 */
function estimateParamsOf_(object) {
  return {
    coefficient: num_(object['коэф общий'], 1) || 1,
    materialCost: num_(object['материал'], 0),
    equipmentCost: num_(object['оборудование'], 0),
    discount: num_(object['скидка'], 0),
    discountType: str_(object['тип скидки']) || 'sum'
  };
}

/**
 * Чтение расчёта объекта из его листа.
 * @param {Object} object — строка листа «Объекты»
 * @return {Object} полный расчёт
 */
function getEstimateOf_(object) {
  const sheetName = str_(object['лист']);
  const rows = sheetName
    ? readBlock_(sheetName, CONFIG.OBJECT_BLOCKS.CALC).map(function (row) {
      return {
        id: str_(row['id']),
        section: str_(row['раздел']),
        position: int_(row['позиция'], 0),
        name: str_(row['наименование']),
        unit: str_(row['единица']),
        price: num_(row['цена'], 0),
        qty: num_(row['количество'], 0),
        coeff: num_(row['коэф'], 0),
        note: str_(row['примечание'])
      };
    })
    : [];

  return computeEstimate_(rows, estimateParamsOf_(object));
}

/**
 * Запись расчёта в лист объекта и итогов в карточку.
 * @param {Object} object — строка листа «Объекты»
 * @param {Object} estimate — результат computeEstimate_
 */
function writeEstimate_(object, estimate) {
  const sheetName = str_(object['лист']);
  if (!sheetName) throw new Error('У объекта не задан лист');

  const header = OBJECT_HEADERS[CONFIG.OBJECT_BLOCKS.CALC];
  const rows = estimate.rows.map(function (row) {
    return {
      'id': row.id || uid_('C'),
      'раздел': row.section,
      'позиция': row.position,
      'наименование': row.name,
      'единица': row.unit,
      'цена': row.price,
      'количество': row.qty,
      'коэф': row.coeff,
      'сумма': row.sum,
      'примечание': row.note
    };
  });

  replaceBlock_(sheetName, CONFIG.OBJECT_BLOCKS.CALC, header, rows);

  updateRow_(CONFIG.SHEETS.OBJECTS, object._row, {
    'коэф общий': estimate.coefficient,
    'материал': estimate.materialCost,
    'оборудование': estimate.equipmentCost,
    'скидка': estimate.discountValue,
    'тип скидки': estimate.discountType,
    'подытог': estimate.subtotal,
    'снабжение': estimate.supply,
    'пусконаладка': estimate.commissioning,
    'итог расчёта': estimate.total,
    'обновлён': nowIso_()
  });
}

/**
 * Получение расчёта объекта.
 * @param {string} token
 * @param {string} id
 * @return {Object}
 */
function calcGet_(token, id) {
  requireSession_(token);
  const object = requireObject_(id);
  const estimate = getEstimateOf_(object);
  return { object: objectView_(object), estimate: estimate };
}

/**
 * Сохранение расчёта объекта.
 * @param {string} token
 * @param {string} id
 * @param {Object} payload — { rows, coefficient, materialCost, equipmentCost, discount, discountType }
 * @return {Object}
 */
function calcSave_(token, id, payload) {
  const session = requireSession_(token);
  const object = requireObject_(id);
  const p = payload || {};

  const inputRows = (p.rows || []).map(function (row) {
    const price = round2_(num_(row.price, 0));
    const qty = num_(row.qty, 0);
    assert_(price >= 0, 'Цена не может быть отрицательной: «' + str_(row.name) + '»', 'VALIDATION');
    assert_(qty >= 0, 'Количество не может быть отрицательным: «' + str_(row.name) + '»', 'VALIDATION');
    return {
      id: str_(row.id) || uid_('C'),
      section: truncate_(row.section, 80),
      position: int_(row.position, 0),
      name: truncate_(row.name, 240),
      unit: truncate_(row.unit, 20),
      price: price,
      qty: qty,
      coeff: num_(row.coeff, 0),
      note: truncate_(row.note, 240)
    };
  });

  const params = {
    coefficient: num_(p.coefficient, 1),
    materialCost: num_(p.materialCost, 0),
    equipmentCost: num_(p.equipmentCost, 0),
    discount: num_(p.discount, 0),
    discountType: str_(p.discountType) || 'sum'
  };

  const estimate = computeEstimate_(inputRows, params);

  return withLock_(function () {
    writeEstimate_(object, estimate);
    logVisit_(session.name, session.role, 'сохранил расчёт объекта ' + objectView_(object).title, {});
    return { ok: true, estimate: estimate };
  });
}

/**
 * Краткие итоги объекта — для списков и аналитики.
 * @param {Object} object
 * @return {Object}
 */
function objectTotalsOf_(object) {
  const estimate = getEstimateOf_(object);
  const sheetName = str_(object['лист']);
  const purchases = sheetName ? readBlock_(sheetName, CONFIG.OBJECT_BLOCKS.PURCHASE) : [];
  const purchasesSum = round2_(purchases.reduce(function (acc, row) {
    return acc + num_(row['сумма'], 0);
  }, 0));

  return {
    subtotal: estimate.subtotal,
    supply: estimate.supply,
    commissioning: estimate.commissioning,
    discount: estimate.discount,
    estimateTotal: estimate.total,
    purchases: purchasesSum,
    positions: estimate.positions
  };
}
