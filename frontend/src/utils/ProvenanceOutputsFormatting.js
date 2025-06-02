// utilities for formatting and calculating costs of provenance outputs


export const calculateProvenanceCost = (inputTokens, outputTokens, model = 'gpt-4o-mini') => {
  // Pricing per 1M tokens (as of 2024)
  const pricing = {
    'gpt-4o-mini': {
      input: 0.15,   // $0.15 per 1M input tokens
      output: 0.60   // $0.60 per 1M output tokens
    },
    'gemini-2.0-flash': {
      input: 0.075,  // $0.075 per 1M input tokens  
      output: 0.30   // $0.30 per 1M output tokens
    }
  };

  const modelPricing = pricing[model] || pricing['gpt-4o-mini'];
  
  const inputCost = (inputTokens / 1_000_000) * modelPricing.input;
  const outputCost = (outputTokens / 1_000_000) * modelPricing.output;
  const totalCost = inputCost + outputCost;

  return {
    inputCost,
    outputCost,
    totalCost,
    formattedCost: formatCost(totalCost),
    model
  };
};

export const formatCost = (cost) => {
  if (cost < 0.001) {
    return `$${(cost * 1000).toFixed(3)}k`; // Show in thousandths for very small costs
  } else if (cost < 0.01) {
    return `$${cost.toFixed(4)}`;
  } else if (cost < 1) {
    return `$${cost.toFixed(3)}`;
  } else {
    return `$${cost.toFixed(2)}`;
  }
};

// Function to detect model from metadata or provenance data
const detectModel = (provenanceData, questionMetadata = null) => {
  // Check if model is specified in the data
  if (provenanceData.model) {
    return provenanceData.model;
  }
  
  if (questionMetadata?.algorithm_method) {
    // You could map algorithm methods to models here
    return 'gpt-4o-mini'; // Default
  }
  
  // Default fallback
  return 'gpt-4o-mini';
};

