import cors from "cors";
import express from "express";

export function createHttpApp({ store, publicBaseUrl, clientId }) {
    const app = express();
    app.disable("x-powered-by");
    app.set("trust proxy", 1);
    app.use(cors());

    app.get("/", (_request, response) => {
        response.json({
            service: "GlobalBadges Bot",
            status: "online",
            inviteUrl: clientId
                ? `https://discord.com/oauth2/authorize?client_id=${clientId}&scope=bot%20applications.commands&permissions=0`
                : null
        });
    });

    app.get("/health", (_request, response) => {
        response.json({ status: "ok" });
    });

    app.get("/users/:userId", (request, response) => {
        if (!/^\d{17,20}$/.test(request.params.userId)) {
            return response.status(400).json({ error: "Invalid Discord user ID" });
        }

        const requestBaseUrl = publicBaseUrl || `${request.protocol}://${request.get("host")}`;
        const badges = store.list(request.params.userId).map(badge => ({
            name: badge.name,
            badge: `${requestBaseUrl}/badges/${encodeURIComponent(badge.filename)}`
        }));
        return response.json(badges.length ? { BadgeVault: badges } : {});
    });

    app.use("/badges", express.static(store.imageDirectory, {
        immutable: true,
        maxAge: "1y",
        fallthrough: false,
        dotfiles: "deny",
        index: false,
        redirect: false,
        setHeaders(response) {
            response.setHeader("X-Content-Type-Options", "nosniff");
        }
    }));

    app.use((error, _request, response, _next) => {
        if (error?.status === 404) return response.status(404).json({ error: "Badge image not found" });
        console.error(error);
        return response.status(500).json({ error: "Internal server error" });
    });

    return app;
}

export function resolvePublicBaseUrl(environment) {
    const configured = environment.PUBLIC_BASE_URL?.trim();
    const value = configured || (environment.RAILWAY_PUBLIC_DOMAIN ? `https://${environment.RAILWAY_PUBLIC_DOMAIN}` : null);
    return value?.replace(/\/$/, "") ?? null;
}
