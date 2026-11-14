// A set's video link (start.gg's vodUrl), which a tournament organizer types in.

// A YouTube video's id and where it starts, in seconds
export interface YoutubeVideo { id: string, start: number }

// The address if it is a web link (http or https), else null: nothing else may become a link
export function webLink(url: unknown): string | null {
    if (typeof url !== 'string') return null;
    try {
        const parsed = new URL(url.trim());
        return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
    } catch {
        return null;
    }
}

// The YouTube video a link points to (watch, youtu.be, live, embed and shorts links), or null for
// any other link. A start time (t=1h2m3s, t=90, start=90) is kept.
export function youtubeVideo(url: unknown): YoutubeVideo | null {
    const link = webLink(url);
    if (!link) return null;
    const { hostname, pathname, searchParams } = new URL(link);
    const host = hostname.replace(/^(www|m|music)\./, '');
    let id: string | null = null;
    if (host === 'youtu.be') id = pathname.split('/')[1];
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
        const [, first, second] = pathname.split('/');
        if (first === 'watch') id = searchParams.get('v');
        else if (['live', 'embed', 'shorts', 'v'].includes(first)) id = second;
    }
    if (!id || !/^[\w-]{11}$/.test(id)) return null;
    return { id, start: seconds(searchParams.get('t') ?? searchParams.get('start')) };
}

// "90", "90s" or "1h2m3s" as seconds; 0 for anything else
function seconds(time: string | null): number {
    if (!time) return 0;
    if (/^\d+s?$/.test(time)) return parseInt(time, 10);
    const parts = time.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
    if (!parts) return 0;
    return Number(parts[1] ?? 0) * 3600 + Number(parts[2] ?? 0) * 60 + Number(parts[3] ?? 0);
}

// The thumbnail YouTube keeps for every video (480 by 360), and the sharper one most videos have
export const youtubeThumbnail = (id: string, sharp = true) => `https://i.ytimg.com/vi/${id}/${sharp ? 'maxresdefault' : 'hqdefault'}.jpg`;

// YouTube's player for the video, from its no-cookie address, playing at once
export const youtubePlayer = ({ id, start }: YoutubeVideo) => `https://www.youtube-nocookie.com/embed/${id}?autoplay=1${start ? `&start=${start}` : ''}`;
