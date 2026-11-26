package ops

type Patroller interface {
	Patrol(street string) error
}

type Constable struct {
	Name string
	Beat int
}

func (c *Constable) Patrol(street string) error {
	c.Beat = len(street)
	return nil
}

func Roster() []Patroller {
	return []Patroller{&Constable{Name: "Carrot"}}
}
