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
    completed: {type:"boolean"}, summary: {type:"string"}, claimedCriteria: {type:"array", items:{type:"string"}},
    evidence: {type:"array", maxItems:50, items:{type:"object", additionalProperties:false, properties:{kind:{enum:["command","file","behavior","note"]},description:{type:"string"},value:{type:"string"}},required:["kind","description"]}},
    workPlan: {type:"array", items:{type:"string"}},
  }, required:["completed","summary","claimedCriteria","evidence","workPlan"],
} as const;

export const verdictSchema = {
  type:"object", additionalProperties:false,
  properties:{achieved:{type:"boolean"},gaps:{type:"array",maxItems:30,items:{type:"object",additionalProperties:false,properties:{criterionId:{type:"string"},problem:{type:"string",minLength:1},evidence:{type:"string"}},required:["problem"]}},notes:{type:"array",items:{type:"string"}}},
  required:["achieved","gaps"],
} as const;

export const strategySchema = {
  type:"object", additionalProperties:false,
  properties:{diagnosis:{type:"string"},recommendedStrategy:{type:"string"},avoidRepeating:{type:"array",items:{type:"string"}}},
  required:["diagnosis","recommendedStrategy","avoidRepeating"],
} as const;
