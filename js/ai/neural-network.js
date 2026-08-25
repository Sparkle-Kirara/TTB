/* =====================================================================
   NEURAL-NETWORK.JS — Generic feedforward Neural Network
   =====================================================================
   This module is intentionally game-agnostic. It knows nothing about
   Snake, boards, food, or fitness. It only knows how to:

     - hold a set of weights/biases for a fixed layer architecture
     - run a forward pass (inputs -> outputs)
     - clone itself
     - mutate its own weights (for neuroevolution)
     - serialize/deserialize its weights (for persistence)

   Architecture (default): 16 -> 24 -> 16 -> 3
     - Hidden layers use tanh activation.
     - Output layer uses softmax (normalized probabilities over 3 actions).

   Nothing here is Snake-specific. Snake's state encoding and action
   mapping live in js/ai/snake-ai.js.
   ===================================================================== */

class NeuralNetwork {
  /**
   * @param {number[]} layerSizes - e.g. [16, 24, 16, 3]
   */
  constructor(layerSizes) {
    this.layerSizes = layerSizes.slice();

    // weights[i] connects layer i to layer i+1: shape [layerSizes[i+1]][layerSizes[i]]
    // biases[i] belongs to layer i+1: shape [layerSizes[i+1]]
    this.weights = [];
    this.biases = [];

    for (let i = 0; i < this.layerSizes.length - 1; i++) {
      const inSize = this.layerSizes[i];
      const outSize = this.layerSizes[i + 1];
      this.weights.push(NeuralNetwork.randomMatrix(outSize, inSize));
      this.biases.push(NeuralNetwork.randomVector(outSize));
    }
  }

  static randomMatrix(rows, cols) {
    const m = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        row.push(NeuralNetwork.randomWeight());
      }
      m.push(row);
    }
    return m;
  }

  static randomVector(size) {
    const v = [];
    for (let i = 0; i < size; i++) v.push(NeuralNetwork.randomWeight());
    return v;
  }

  // Small random initial weights, roughly in [-1, 1].
  static randomWeight() {
    return Math.random() * 2 - 1;
  }

  static tanh(x) {
    return Math.tanh(x);
  }

  static softmax(arr) {
    const max = Math.max(...arr);
    const exps = arr.map(v => Math.exp(v - max)); // subtract max for numerical stability
    const sum = exps.reduce((a, b) => a + b, 0);
    return exps.map(v => v / sum);
  }

  /**
   * Runs a forward pass.
   * @param {number[]} inputs - length must match layerSizes[0]
   * @returns {number[]} outputs - length matches the final layer size, softmax-normalized
   */
  predict(inputs) {
    if (inputs.length !== this.layerSizes[0]) {
      throw new Error(`NeuralNetwork.predict: expected ${this.layerSizes[0]} inputs, got ${inputs.length}`);
    }

    let activations = inputs;
    const lastLayerIndex = this.weights.length - 1;

    for (let layer = 0; layer <= lastLayerIndex; layer++) {
      const w = this.weights[layer];
      const b = this.biases[layer];
      const next = new Array(w.length);

      for (let n = 0; n < w.length; n++) {
        let sum = b[n];
        const row = w[n];
        for (let i = 0; i < row.length; i++) {
          sum += row[i] * activations[i];
        }
        next[n] = sum;
      }

      const isOutputLayer = (layer === lastLayerIndex);
      activations = isOutputLayer ? NeuralNetwork.softmax(next) : next.map(NeuralNetwork.tanh);
    }

    return activations;
  }

  /** Deep-copies this network (weights + biases), same architecture. */
  clone() {
    const copy = new NeuralNetwork(this.layerSizes);
    copy.weights = this.weights.map(matrix => matrix.map(row => row.slice()));
    copy.biases = this.biases.map(vec => vec.slice());
    return copy;
  }

  /**
   * Mutates weights/biases in place. Each individual weight has `rate`
   * probability of being nudged by a random amount, scaled by `amount`.
   * This is intentionally simple (uniform nudge, not Gaussian) to keep
   * neuroevolution easy to understand and tune.
   */
  mutate(rate = 0.1, amount = 0.3) {
    const mutateValue = (v) => {
      if (Math.random() < rate) {
        return v + (Math.random() * 2 - 1) * amount;
      }
      return v;
    };

    this.weights = this.weights.map(matrix => matrix.map(row => row.map(mutateValue)));
    this.biases = this.biases.map(vec => vec.map(mutateValue));
  }

  /** Returns a plain-object representation suitable for JSON.stringify. */
  toJSON() {
    return {
      layerSizes: this.layerSizes,
      weights: this.weights,
      biases: this.biases
    };
  }

  /** Reconstructs a NeuralNetwork from the shape produced by toJSON(). */
  static fromJSON(data) {
    const net = new NeuralNetwork(data.layerSizes);
    net.weights = data.weights;
    net.biases = data.biases;
    return net;
  }
}
