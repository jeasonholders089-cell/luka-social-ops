# Luka social-media data capabilities

Use this reference when the user asks what social-media data Luka can call,
which platforms are supported, what can be retrieved from a URL or account, or
whether a particular data field is available.

This is a capability-family map. It is intentionally broader than the installed
Open API's high-level jobs. Exact tools, fields, sorting, pagination,
historical depth, and authorization depend on the selected platform, the
hosting runtime's current tool registry, and the workspace's API scope.

## Capability families

| Capability family | Data and actions that may be available | Typical starting inputs |
|---|---|---|
| Search and discovery | Keyword search; account/user search; note, post, or video search; comprehensive search; hashtag/topic search; music search; product or company search where supported | Platform and keyword, topic, or category |
| Account profiles | Display name, avatar, bio, verification, follower/following/content counts, account statistics, and recent activity | Account URL or platform account ID |
| Account content | Published notes, videos, posts, articles, replies, Reels, or other account content lists | Account URL or ID, optional date range or result limit |
| Content details | One note, video, post, article, question, answer, thread, or item; media metadata; author; publish time; caption or description; cover or media URL; interaction metrics | Content URL or content ID |
| Metrics and performance | Views/plays, likes, comments, shares, saves/collections, and other platform-exposed metrics for a content item or account sample | Account or content identifier |
| Comments and discussion | Top-level comments, replies or sub-comments, comment authors, times, and available interaction metadata | Content URL or ID, result limit, and ordering when supported |
| Hot lists and trends | Hot search lists, rankings, trending content, popular feeds, creator inspiration, and trend keywords | Platform and optional category, date, or result limit |
| Hashtags, topics, and communities | Topic/hashtag/challenge details and the content published under them; subreddits or groups where exposed | Topic or hashtag text/ID; community identifier where required |
| Fans and relationships | Follower or following lists and relationship counts when the platform exposes them | Account URL or ID and result limit |
| Live-stream data | Live-room information, active or popular rooms, and danmaku/chat where supported | Platform, room ID, or live category |
| Music and sound | Music/sound details, charts, trending tracks, and content associated with a track where supported | Music ID, keyword, or chart category |
| Creator and analytics | Creator tools, creator activity, work analysis, audience or content analytics when exposed by the platform | Creator/account identifier and requested metric |
| Commerce and professional data | Product details and search, shop or campaign data, company profiles, job data, and ad/trend metadata where supported | Product, shop, company, job, or campaign identifier |
| Places and media enrichment | Location details and posts, stories/Reels, subtitles or captions, related videos, and link-to-content resolution where supported | URL, location ID, or media ID |

## Platform coverage

`Yes` means the platform generally exposes this family through the current
social-data catalog. `Partial` means coverage depends on the endpoint, resource
type, or account permission. `Not exposed` means do not promise it without a
new live discovery result confirming support.

| Platform | Search | Account | Content | Comments | Hot/trends | Topics | Fans | Live | Creator/commerce |
|---|---|---|---|---|---|---|---|---|---|
| Douyin | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes; also music, short drama, Xingtu/business data |
| TikTok | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes; also ads, ecommerce, trends |
| Instagram | Yes | Yes | Yes | Yes | Partial | Yes | Yes | Not exposed | Partial; locations, Reels, Stories, music |
| Xiaohongshu | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Not exposed | Partial; products and creator inspiration |
| Weibo | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Not exposed | Partial; AI search, favorites and groups |
| Bilibili | Yes | Yes | Yes | Yes | Yes | Partial | Partial | Yes | Partial; captions, collections, dynamics |
| YouTube | Yes | Yes | Yes | Yes | Yes | Partial | Partial | Not exposed | Partial; captions, related videos, channel data |
| Kuaishou | Yes | Yes | Yes | Yes | Yes | Partial | Partial | Yes | Partial; collections and live data |
| Zhihu | Yes | Yes | Yes | Yes | Yes | Yes | Partial | Not exposed | Partial; questions, columns, followed topics |
| LinkedIn | Yes | Yes | Yes | Partial | Not exposed | Partial | Partial | Not exposed | Yes; company profiles and jobs |
| Reddit | Yes | Yes | Yes | Yes | Partial | Yes | Partial | Not exposed | Partial; subreddit/community data |
| Lemon8 | Yes | Yes | Yes | Yes | Yes | Partial | Partial | Not exposed | Partial; feed and creator content |
| Twitter/X | Yes | Yes | Yes | Yes | Yes | Partial | Yes | Partial | Partial; communities, trends and creator data |
| Threads | Yes | Yes | Yes | Yes | Partial | Partial | Partial | Not exposed | Partial; replies and social graph data where exposed |
| WeChat Official Accounts | Yes | Yes | Yes | Yes | Not exposed | Partial | Partial | Not exposed | Articles, account metadata and search |
| WeChat Channels | Yes | Yes | Yes | Yes | Partial | Yes | Partial | Partial | Search, profile and video data where exposed |

## Platform highlights

- Douyin and TikTok have the widest long tail: search, user and content data,
  comments, rankings, topics, fans, live rooms, music, creator metrics, ads,
  ecommerce, and other commercial datasets.
- Xiaohongshu supports note search, account notes, note details, comments,
  hot/creator inspiration, topics, relationship counts and lists where exposed,
  and product data.
- Instagram supports profiles, posts, Reels, Stories, comments, hashtags,
  locations, music-linked content, and follower/following data where exposed.
- Weibo, Bilibili, Kuaishou, Zhihu and YouTube combine content retrieval with
  rankings or recommendation surfaces and platform-specific extras such as AI
  search, dynamics, captions, subtitles, or live data.
- LinkedIn, Reddit, Lemon8, Twitter/X and Threads cover professional, community,
  or short-form social datasets; use the current registry for exact fields.
- WeChat data is split between Official Account articles/search and Channels
  profiles, videos, comments, topics and search results.

## Query recipes

These are capability examples, not CLI commands:

| User goal | Data families | Minimum inputs |
|---|---|---|
| Find fast-growing topics | Keyword search, hot/trends, topic content, content metrics | Platform; keyword or category; optional time window |
| Inspect a competitor | Account profile, account content, content metrics, comments | Account URL or ID; optional sample size |
| Analyse one note/video/post | Content detail, metrics, comments, replies, media captions | Content URL or ID; optional comment limit |
| Find creators in a niche | Account search, profiles, recent content, metrics | Platform and niche keyword or seed account |
| Track a hashtag/topic | Topic detail, topic content, metrics, comments | Topic/hashtag and platform |
| Understand live activity | Hot/live rooms, room info, danmaku | Platform; category or room ID when required |
| Study products or companies | Product/company/job search and details | Platform; product, company, or job identifier |

## Availability etiquette

- Give the full capability families first when the user asks for an overview;
  then narrow to the query the user selects.
- Separate what the platform exposes from what the current workspace or API key
  is authorized to call. A missing scope is not evidence that the platform has
  no such data.
- Before a charged or quota-consuming call, state the requested data and known
  cost or usage. If the exact cost is not exposed, ask the user to confirm the
  call rather than guessing a number.
- Do not expose internal provider names, authorization headers, API keys, or
  raw environment values.
- Do not claim private messages, private account back-office statistics, or
  login-only relationship lists. Use public or explicitly authorized data only.
- Do not use browser automation to bypass platform limits or permissions.
