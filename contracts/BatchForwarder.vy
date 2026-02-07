MAX_CALLS: constant(uint256) = 16

interface Batcher:
    def execute(_targets: DynArray[address, MAX_CALLS], _datas: DynArray[Bytes[1024], MAX_CALLS]): nonpayable

implements: Batcher

@external
def execute(_targets: DynArray[address, MAX_CALLS], _datas: DynArray[Bytes[1024], MAX_CALLS]):
    extcall Batcher(msg.sender).execute(_targets, _datas)
