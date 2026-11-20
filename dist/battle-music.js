// Choose from the installed music catalog. Some arenas share a track until
// they have a dedicated one in the catalog.
const arenaTracks = {
  qiyun: 's1',
  sn03: 's6', sn04: 's2', sn05: 's6',
  sn07: 's10', sn08: 's2', sn09: 's2',
  sn11: 's6', sn12: 's10', sn13: 's1',
  sn14: 's2', sn15: 's2', sn16: 's10',
  sn17: 's6', sn18: 's2', sn19: 's1', sn20: 's1', sn21: 's10'
};

export function battleMusic(mapId, catalog, missionTrack) {
  const battleTracks = (catalog || []).filter(track => track.id !== 'menu' && track.url);
  const numbered = /^sn(\d+)$/.exec(mapId);
  const matching = numbered ? `s${Number(numbered[1])}` : null;
  return battleTracks.find(track => missionTrack && track.url.endsWith('/' + missionTrack))?.url
    || battleTracks.find(track => track.id === matching)?.url
    || battleTracks.find(track => track.id === arenaTracks[mapId])?.url
    || battleTracks[0]?.url
    || null;
}
