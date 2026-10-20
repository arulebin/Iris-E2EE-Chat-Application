import { gunzipSync, gzipSync } from 'fflate'
import type { Bytes } from './crypto/provider.ts'

/**
 * gzip / gunzip for platforms without CompressionStream (Hermes). Pass as the
 * `gzip` / `gunzip` options of createSubtleProvider. Imported from
 * '@iris/core/fflate' (not the main entry) so web bundles never pull fflate in.
 * Output is plain RFC 1952 gzip, readable by browsers' DecompressionStream.
 */
export const fflateGzip = async (data: Bytes): Promise<Bytes> => gzipSync(data)
export const fflateGunzip = async (data: Bytes): Promise<Bytes> => gunzipSync(data)
