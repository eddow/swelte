module article

import net.urllib
import os

pub struct ArticleData {
pub:
	locale string
	title string
	canonical string
}

@[load]
pub fn load_article(req SwelteRequest, parent Route_LayoutData) !ArticleData {
	locale := req.params['lang']
	slug := req.params['slug']
	if slug == 'redirect' { return swelte_redirect_error('/?login=1', 303) }
	if slug == 'broken' { return error('article failure') }
	if locale !in ['en', 'fr', 'ro'] { return swelte_error(404, 'unknown language') }
	title := match locale { 'fr' { 'Bonjour ' + slug } 'ro' { 'Salut ' + slug } else { 'Hello ' + slug } }
	origin := os.getenv_opt('SWELTE_ORIGIN') or { 'https://dogfood.example' }
	return ArticleData{parent.locale, title, origin.trim_right('/') + '/' + locale + '/article/' + urllib.path_escape(slug)}
}
