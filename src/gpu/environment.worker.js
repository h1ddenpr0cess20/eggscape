import { prefilterPixels } from './environment.js';

/** The environment prefilter, run where it cannot hold up a frame. */
self.onmessage = ({ data }) => {
  const env = prefilterPixels(data);
  self.postMessage(env, [env.data.buffer]);
};
