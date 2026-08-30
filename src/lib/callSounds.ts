// Ringing sound for outgoing calls using Web Audio API
let ringInterval: ReturnType<typeof setInterval> | null = null;
let ringCtx: AudioContext | null = null;
let ringStopped = false;

async function resumeCtx(ctx: AudioContext): Promise<boolean> {
  if (ctx.state === "suspended") {
    try { await ctx.resume(); } catch { return false; }
  }
  return ctx.state === "running";
}

export async function startRinging() {
  await stopRinging();
  ringStopped = false;

  try {
    ringCtx = new AudioContext();
    const ok = await resumeCtx(ringCtx);
    if (!ok) {
      // Try once more after a short delay (browser may need another event loop tick)
      await new Promise(r => setTimeout(r, 100));
      await resumeCtx(ringCtx);
    }

    const playTone = () => {
      if (ringStopped || !ringCtx || ringCtx.state === "closed" || ringCtx.state === "suspended") return;

      try {
        // Create a phone ring tone (WhatsApp-like)
        const osc1 = ringCtx.createOscillator();
        const osc2 = ringCtx.createOscillator();
        const gain = ringCtx.createGain();

        osc1.type = "sine";
        osc1.frequency.value = 440; // A4
        osc2.type = "sine";
        osc2.frequency.value = 480; // A#4

        gain.gain.value = 0;
        gain.gain.linearRampToValueAtTime(0.15, ringCtx.currentTime + 0.05);
        gain.gain.linearRampToValueAtTime(0, ringCtx.currentTime + 0.4);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ringCtx.destination);

        osc1.start(ringCtx.currentTime);
        osc2.stop(ringCtx.currentTime + 0.4);
        osc1.stop(ringCtx.currentTime + 0.4);

        // Second burst after short pause
        setTimeout(() => {
          if (ringStopped || !ringCtx || ringCtx.state === "closed" || ringCtx.state === "suspended") return;
          try {
            const osc3 = ringCtx.createOscillator();
            const osc4 = ringCtx.createOscillator();
            const gain2 = ringCtx.createGain();

            osc3.type = "sine";
            osc3.frequency.value = 440;
            osc4.type = "sine";
            osc4.frequency.value = 480;

            gain2.gain.value = 0;
            gain2.gain.linearRampToValueAtTime(0.15, ringCtx.currentTime + 0.05);
            gain2.gain.linearRampToValueAtTime(0, ringCtx.currentTime + 0.4);

            osc3.connect(gain2);
            osc4.connect(gain2);
            gain2.connect(ringCtx.destination);

            osc3.start(ringCtx.currentTime);
            osc4.stop(ringCtx.currentTime + 0.4);
            osc3.stop(ringCtx.currentTime + 0.4);
          } catch {}
        }, 500);
      } catch {}
    };

    playTone();
    ringInterval = setInterval(playTone, 2000); // Ring every 2 seconds
  } catch (e) {
    console.log("Could not play ring tone:", e);
  }
}

export async function stopRinging() {
  ringStopped = true;
  if (ringInterval) {
    clearInterval(ringInterval);
    ringInterval = null;
  }
  if (ringCtx) {
    try { await ringCtx.close(); } catch {}
    ringCtx = null;
  }
}

// Incoming call ringtone (louder, different pattern)
let incomingCtx: AudioContext | null = null;
let incomingInterval: ReturnType<typeof setInterval> | null = null;
let incomingStopped = false;

export async function startIncomingRing() {
  await stopIncomingRing();
  incomingStopped = false;

  try {
    incomingCtx = new AudioContext();
    const ok = await resumeCtx(incomingCtx);
    if (!ok) {
      await new Promise(r => setTimeout(r, 100));
      await resumeCtx(incomingCtx);
    }

    const playTone = () => {
      if (incomingStopped || !incomingCtx || incomingCtx.state === "closed" || incomingCtx.state === "suspended") return;

      try {
        // WhatsApp-like incoming ring
        const osc = incomingCtx.createOscillator();
        const gain = incomingCtx.createGain();

        osc.type = "sine";
        osc.frequency.value = 520;

        gain.gain.value = 0;
        gain.gain.linearRampToValueAtTime(0.2, incomingCtx.currentTime + 0.05);
        gain.gain.linearRampToValueAtTime(0.2, incomingCtx.currentTime + 0.3);
        gain.gain.linearRampToValueAtTime(0, incomingCtx.currentTime + 0.5);

        osc.connect(gain);
        gain.connect(incomingCtx.destination);

        osc.start(incomingCtx.currentTime);
        osc.stop(incomingCtx.currentTime + 0.5);
      } catch {}
    };

    playTone();
    incomingInterval = setInterval(playTone, 1000);
  } catch (e) {
    console.log("Could not play incoming ring:", e);
  }
}

export async function stopIncomingRing() {
  incomingStopped = true;
  if (incomingInterval) {
    clearInterval(incomingInterval);
    incomingInterval = null;
  }
  if (incomingCtx) {
    try { await incomingCtx.close(); } catch {}
    incomingCtx = null;
  }
}
