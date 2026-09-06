export const plannerSchema = {
  type: "object", additionalProperties: false,
  properties: {
    contract: {
      type: "object", additionalProperties: false,
      properties: {
        objective: { type: "string", minLength: 1 },
        acceptanceCriteria: { type: "array", minItems: 1, maxItems: 30, items: { type: "object", additionalProperties: false, properties: { id: {type:"string", minLength:1}, requirement: {type:"string", minLength:1}, verification: {type:"string"} }, required: ["id", "requirement"] } },
        constraints: { type: "array", items: {type:"string"} }, nonGoals: { type: "array", items: {type:"string"} }, verificationPlan: { type: "array", items: {type:"string"} },
      }, required: ["objective", "acceptanceCriteria", "constraints", "nonGoals", "verificationPlan"],
    },
    workPlan: { type: "array", minItems: 1, maxItems: 40, items: {type:"string"} },
  }, required: ["contract", "workPlan"],
} as const;

export const workerSchema = {
  type: "object", additionalProperties: false,
  properties: {
    outcome: {enum:["continue","candidate","blocked"]}, completed: {type:"boolean"}, blockedReason:{type:"string",minLength:1}, summary: {type:"string"}, claimedCriteria: {type:"array", items:{type:"string"}},
    evidence: {type:"array", maxItems:50, items:{type:"object", additionalProperties:false, properties:{kind:{enum:["command","file","behavior","note"]},description:{type:"string"},value:{type:"string"}},required:["kind","description"]}},
    workPlan: {type:"array", items:{type:"string"}},
  }, required:["completed","summary","claimedCriteria","evidence","workPlan"],
  allOf:[
    {if:{properties:{outcome:{const:"candidate"}},required:["outcome"]},then:{properties:{completed:{const:true}}}},
    {if:{properties:{outcome:{const:"continue"}},required:["outcome"]},then:{properties:{completed:{const:false}}}},
    {if:{properties:{outcome:{const:"blocked"}},required:["outcome"]},then:{properties:{completed:{const:false}},required:["blockedReason"]}},
  ],
} as const;

export const verdictSchema = {
  oneOf:[
    {type:"object",additionalProperties:false,properties:{kind:{const:"verdict"},achieved:{type:"boolean"},gaps:{type:"array",maxItems:30,items:{type:"object",additionalProperties:false,properties:{criterionId:{type:"string"},problem:{type:"string",minLength:1},evidence:{type:"string"}},required:["problem"]}},notes:{type:"array",items:{type:"string"}}},required:["kind","achieved","gaps"],allOf:[{if:{properties:{achieved:{const:true}},required:["achieved"]},then:{properties:{gaps:{maxItems:0}}}}]},
    {type:"object",additionalProperties:false,properties:{kind:{const:"infrastructure"},reason:{type:"string",minLength:1}},required:["kind","reason"]},
  ],
} as const;

export const strategySchema = {
  type:"object", additionalProperties:false,
  properties:{diagnosis:{type:"string"},recommendedStrategy:{type:"string"},avoidRepeating:{type:"array",items:{type:"string"}}},
  required:["diagnosis","recommendedStrategy","avoidRepeating"],
} as const;
