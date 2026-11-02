// Item 7: integer-constrained dynamic leaf. [id=integer] narrows
// Params.id to number on the client; non-digits 404 on V dispatch.
// Ships under members/ (not users/): users/[id].v and
// users/[id=integer].v normalize to the same dynamic shape (/users/[])
// and the generator rejects coexisting same-dir dynamics.
module members_id_integer

@[get]
pub fn member_detail_int(req SwelteRequest) string {
	id := req.params['id'] or { '' }
	return 'member-int:' + id
}
