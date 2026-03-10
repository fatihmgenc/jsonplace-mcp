const readyTemplates = [
  {
    id: "starter-user",
    title: "Starter User",
    description: "Identity + company profile data",
    fields: [
      { propName: "Id", parentTypeSelectionName: "random", typeSelectionName: "uuid" },
      { propName: "FirstName", parentTypeSelectionName: "name", typeSelectionName: "firstName" },
      { propName: "LastName", parentTypeSelectionName: "name", typeSelectionName: "lastName" },
      { propName: "Email", parentTypeSelectionName: "internet", typeSelectionName: "email" },
      { propName: "Company", parentTypeSelectionName: "company", typeSelectionName: "companyName" },
      { propName: "City", parentTypeSelectionName: "address", typeSelectionName: "city" }
    ]
  },
  {
    id: "starter-order",
    title: "E-Commerce Order",
    description: "Simple order payload with product and pricing",
    fields: [
      { propName: "OrderId", parentTypeSelectionName: "random", typeSelectionName: "uuid" },
      { propName: "Product", parentTypeSelectionName: "commerce", typeSelectionName: "productName" },
      { propName: "Price", parentTypeSelectionName: "commerce", typeSelectionName: "price" },
      { propName: "Currency", parentTypeSelectionName: "finance", typeSelectionName: "currencyCode" },
      { propName: "OrderDate", parentTypeSelectionName: "date", typeSelectionName: "past" },
      { propName: "Notes", parentTypeSelectionName: "lorem", typeSelectionName: "sentence" }
    ]
  },
  {
    id: "starter-vehicle",
    title: "Vehicle Registry",
    description: "Vehicle details plus ownership metadata",
    fields: [
      { propName: "RecordId", parentTypeSelectionName: "random", typeSelectionName: "uuid" },
      { propName: "Manufacturer", parentTypeSelectionName: "vehicle", typeSelectionName: "manufacturer" },
      { propName: "Model", parentTypeSelectionName: "vehicle", typeSelectionName: "model" },
      { propName: "Owner", parentTypeSelectionName: "name", typeSelectionName: "lastName" },
      { propName: "City", parentTypeSelectionName: "address", typeSelectionName: "city" }
    ]
  }
];

export default readyTemplates;
