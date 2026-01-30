let execaFnPromise;

async function loadExeca() {
  if (!execaFnPromise) {
    execaFnPromise = import('execa').then((mod) => mod.execa || mod.default);
  }
  return execaFnPromise;
}

module.exports = { loadExeca };
