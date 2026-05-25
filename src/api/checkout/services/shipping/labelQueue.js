const tasks = [];
let running = false;

async function runNext() {
  if (running || tasks.length === 0) {
    return;
  }

  running = true;
  const task = tasks.shift();

  try {
    await task();
  } finally {
    running = false;
    setImmediate(runNext);
  }
}

function enqueue(task) {
  return new Promise((resolve, reject) => {
    tasks.push(async () => {
      try {
        const result = await task();
        resolve(result);
      } catch (error) {
        reject(error);
      }
    });

    setImmediate(runNext);
  });
}

module.exports = {
  enqueue,
};
