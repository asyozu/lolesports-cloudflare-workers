const API = 'https://esports-api.lolesports.com/persisted/gw';
const WATCH = 'https://rex.rewards.lolesports.com/v1/events/watch';
const HEADERS = {
    'x-api-key': '0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
    'Referer': 'https://lolesports.com/'
};
export default {
    async scheduled(_, env) {
        const state = await env.KV.get("bot_state", "json") || { accessToken: null, cache: {} };
        let hasChange = false; 
        const req = async (url, method = "GET", body = null, token = state.accessToken) => {
            const h = { ...HEADERS, ...(token ? { 'Authorization': `Bearer ${token}` } : {}) };
            if (body) h['Content-Type'] = 'application/json';
            return fetch(url, { method, headers: h, body: body ? JSON.stringify(body) : null });
        };
        const refresh = async () => {
            try {
                const res = await fetch("https://xsso.lolesports.com/refresh", {
                    headers: { ...HEADERS, "Cookie": `__Secure-refresh_token=${env.REFRESH_TOKEN}` },
                    redirect: "manual"
                });
                const c = res.headers.get("set-cookie");
                if (!c) return false;
                const newToken = c.match(/access_token=([^;]+)/)?.[1];
                if (newToken && newToken !== state.accessToken) {
                    state.accessToken = newToken;
                    try {
                        const { acct } = JSON.parse(decodeURIComponent(c.match(/id_hint=([^;]+)/)?.[1]));
                        console.log(`Logged in as: ${acct.game_name}#${acct.tag_line}`);
                    } catch {}
                    hasChange = true;
                    return true;
                }
            } catch (e) {}
            return false;
        };
        if (!state.accessToken && !await refresh()) return console.error("Login Fail");
        try {
            const events = (await (await req(`${API}/getLive?hl=en-US`)).json()).data?.schedule?.events || [];
            const liveIds = new Set(events.map(e => e.id));
            const oldLen = Object.keys(state.cache).length;
            state.cache = Object.fromEntries(Object.entries(state.cache).filter(([id]) => liveIds.has(id)));
            if (Object.keys(state.cache).length !== oldLen) hasChange = true; 
            if (events.length) {
                const activeLeagues = [];
                for (const e of events) {
                    const id = e.id;
                    if (!state.cache[id]) {
                        try {
                            const d = (await (await req(`${API}/getEventDetails?hl=en-US&id=${id}`)).json()).data?.event;
                            const s = d?.streams?.find(s => s.provider && s.parameter);
                            if (s) {
                                state.cache[id] = { t_id: d.tournament.id, s_p: s.parameter, s_pv: s.provider };
                                hasChange = true;
                            }
                        } catch { continue; }
                    }
                    const c = state.cache[id];
                    if (!c) continue;
                    const payload = { stream_id: c.s_p, source: c.s_pv, stream_position_time: new Date().toISOString(), geolocation: { code: "VN", area: "AS" }, tournament_id: c.t_id };
                    let res = await req(WATCH, "POST", payload);
                    if (res.status === 401) {
                        if (await refresh()) { 
                            await req(WATCH, "POST", payload, state.accessToken);
                        }
                    }
                    if (e.league?.name) activeLeagues.push(e.league.name);
                }
                if (activeLeagues.length) {
                    console.log(`${activeLeagues.join(' ')}`);
                }
            } else console.log("No live events.");
        } catch (e) { console.error(e.message); }
        if (hasChange) {
            await env.KV.put("bot_state", JSON.stringify(state));
        }
    }
};