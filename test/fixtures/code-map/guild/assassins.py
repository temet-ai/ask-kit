"""The Assassins' Guild."""
FEE = 100


class Guild:
    def members(self):
        return []


class Assassins(Guild):
    rank: str = "student"

    def contract(self, target,
                 fee=FEE):
        return f"{target} for {fee}"

    def __init__(self):
        self.rank = "black"


def enrol():
    return Assassins().contract("Lord Vetinari")
