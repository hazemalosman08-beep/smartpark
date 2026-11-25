import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import locateVehicleCenters from '../../shared/vehicleCenters.ts';

// A private upload comes back as a storage key in more than one shape, so any
// non-URL storage reference is read from private storage; only app storage URLs
// are accepted as URLs (never arbitrary internet links).
const isPrivateImage = (value) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 1200 &&
  !value.includes('..') &&
  !/^[a-z][a-z0-9+.-]*:/i.test(value);

export default async function (req) {
  try {
    const body = await req.json().catch(() => ({}));
    const fileUri = typeof body?.file_uri === 'string' ? body.file_uri : '';
    if (!isPrivateImage(fileUri)) {
      return Response.json({ error: 'file_uri must be a frame uploaded by this app' }, { status: 400 });
    }
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch((e) => (e.status === 401 ? null : Promise.reject(e)));
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const cars = await locateVehicleCenters(base44, fileUri);
    return Response.json({ cars });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}