// Runs libsignal's curve25519 with WebAssembly deleted, as on Hermes.
delete globalThis.WebAssembly
const mod = await import('@privacyresearch/libsignal-protocol-typescript')
const { KeyHelper } = mod.default ?? mod
const t0 = Date.now()
const kp = await KeyHelper.generateIdentityKeyPair()
const spk = await KeyHelper.generateSignedPreKey(kp, 1)
console.log(`wasm=${typeof WebAssembly} ms=${Date.now() - t0}`)
console.log(spk.signature.byteLength === 64 ? 'signature-ok' : 'signature-bad')
