MAX_CALLS: constant(uint256) = 16
BATCHER: constant(address) = 0xc0E16d6D6cf4DAe4E561Cc5Dd3C868378F673C09

@external
@payable
def __default__():
    pass

@external
def execute(_targets: DynArray[address, MAX_CALLS], _datas: DynArray[Bytes[1024], MAX_CALLS]):
    assert msg.sender in [self, BATCHER]

    num: uint256 = len(_targets)
    assert len(_datas) == num

    for i: uint256 in range(num, bound=MAX_CALLS):
        raw_call(_targets[i], _datas[i])
