#!/usr/bin/env node
const { execSync } = require('child_process');

const port = process.env.PORT || '3000';

function freePort(targetPort) {
  try {
    const pidList = execSync(`lsof -ti tcp:${targetPort}`, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .split('\n')
      .filter(Boolean);

    if (pidList.length === 0) {
      console.log(`[free-port] Port ${targetPort} is already free.`);
      return;
    }

    pidList.forEach((pid) => {
      try {
        process.kill(Number(pid), 'SIGTERM');
        console.log(`[free-port] Sent SIGTERM to PID ${pid} on port ${targetPort}.`);
      } catch (killErr) {
        console.warn(`[free-port] Failed to terminate PID ${pid} gracefully: ${killErr.message}`);
      }
    });

    // Verify whether port freed; if not, escalate
    const stillBound = execSync(`lsof -ti tcp:${targetPort} || true`, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .split('\n')
      .filter(Boolean);

    if (stillBound.length > 0) {
      stillBound.forEach((pid) => {
        try {
          process.kill(Number(pid), 'SIGKILL');
          console.log(`[free-port] Sent SIGKILL to PID ${pid} on port ${targetPort}.`);
        } catch (killErr) {
          console.warn(`[free-port] Failed to forcefully terminate PID ${pid}: ${killErr.message}`);
        }
      });
    }
  } catch (err) {
    if (err.status === 1) {
      console.log(`[free-port] Port ${targetPort} is already free.`);
    } else {
      console.error(`[free-port] Unexpected error checking port ${targetPort}:`, err.message);
      process.exit(1);
    }
  }
}

freePort(port);
