function buildFilterExpression(filters) {
  if (!filters || filters.length === 0) return undefined;

  return {
    andGroup: {
      expressions: filters.map(({ fieldName, stringValue }) => ({
        filter: {
          fieldName,
          stringFilter: {
            matchType: 'EXACT',
            value: stringValue,
          },
        },
      })),
    },
  };
}

module.exports = buildFilterExpression;
