package auth

type Role string

const (
	RoleNone     Role = "none"
	RoleViewer   Role = "viewer"
	RoleOperator Role = "operator"
	RoleAdmin    Role = "admin"
)

var ranks = map[Role]int{RoleNone: 0, RoleViewer: 1, RoleOperator: 2, RoleAdmin: 3}

func (r Role) valid() bool {
	_, ok := ranks[r]
	return ok
}

func (r Role) Allows(need Role) bool {
	return ranks[r] >= ranks[need]
}

type Principal struct {
	Username string          `json:"username"`
	Role     Role            `json:"role"`
	Clusters map[string]Role `json:"clusters"`
}

func (p Principal) RoleFor(cluster string) Role {
	if p.Role == RoleAdmin {
		return RoleAdmin
	}
	if r, ok := p.Clusters[cluster]; ok {
		return r
	}
	return p.Role
}

func (p Principal) Can(cluster string, need Role) bool {
	return p.RoleFor(cluster).Allows(need)
}

func (p Principal) IsAdmin() bool {
	return p.Role == RoleAdmin
}
