const DEFAULT_CACHE_TTL = 15 * 60 * 1000;

export class LegacyBadgeSource {
    constructor(baseUrl, { cacheTtl = DEFAULT_CACHE_TTL, fetchImpl = fetch } = {}) {
        this.baseUrl = baseUrl.replace(/\/$/, "");
        this.cacheTtl = cacheTtl;
        this.fetchImpl = fetchImpl;
        this.cache = new Map();
    }

    async get(userId) {
        const cached = this.cache.get(userId);
        if (cached && cached.expires > Date.now()) return cached.badges;

        try {
            const response = await this.fetchImpl(`${this.baseUrl}/users/${userId}.json`, {
                signal: AbortSignal.timeout(5000)
            });
            if (response.status === 404) return this.remember(userId, {});
            if (!response.ok) throw new Error(`Legacy badge request failed with ${response.status}`);

            const badges = await response.json();
            if (!badges || typeof badges !== "object" || Array.isArray(badges)) {
                throw new Error("Legacy badge response has an invalid structure");
            }
            return this.remember(userId, badges);
        } catch (error) {
            console.error(`Could not load legacy badges for ${userId}`, error);
            return cached?.badges ?? {};
        }
    }

    remember(userId, badges) {
        this.cache.set(userId, { badges, expires: Date.now() + this.cacheTtl });
        return badges;
    }
}

export function mergeBadgeData(legacyBadges, managedBadges) {
    const merged = {};
    for (const [client, badges] of Object.entries(legacyBadges ?? {})) {
        if (Array.isArray(badges) && badges.length) merged[client] = [...badges];
    }

    if (managedBadges.length) {
        const existing = merged.BadgeVault ?? [];
        const seen = new Set(existing.map(badge => JSON.stringify(badge)));
        merged.BadgeVault = [...existing];
        for (const badge of managedBadges) {
            const key = JSON.stringify(badge);
            if (!seen.has(key)) {
                seen.add(key);
                merged.BadgeVault.push(badge);
            }
        }
    }
    return merged;
}
